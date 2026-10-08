#!/usr/bin/env python3
"""Regression test for `bun run check` cleanup on a real Ctrl-C (RX-9).

Run: python3 -I scripts/check-sigint-test.py [scenario ...]   (default: all)

A terminal Ctrl-C sends SIGINT to the whole foreground process group, so each scenario starts
`bun run check` in its own session and signals the whole group with os.killpg. Needs Docker,
network access to origin and an installed repo (bun install + prisma generate).
Python 3 standard library only. Anything a scenario leaves behind is removed by exact name.
"""
import os
import queue
import re
import shutil
import signal
import subprocess
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXIT_WAIT = 120


def sh(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, **kw)


class Run:
    def __init__(self):
        env = {k: v for k, v in os.environ.items() if k not in ("TEST_DATABASE_URL", "DATABASE_URL")}
        self.p = subprocess.Popen(["bun", "run", "check"], cwd=ROOT, env=env, start_new_session=True,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        self.pgid = os.getpgid(self.p.pid)
        self.lines = []
        self.q = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        try:
            for line in self.p.stdout:
                self.lines.append(line.rstrip("\n"))
                self.q.put(line.rstrip("\n"))
        except ValueError:  # stdout closed on purpose by a scenario
            pass

    def wait_for(self, prefix, timeout=180):
        end = time.time() + timeout
        while time.time() < end:
            try:
                line = self.q.get(timeout=0.5)
            except queue.Empty:
                if self.p.poll() is not None and self.q.empty():
                    break
                continue
            if line.startswith(prefix):
                return line
        raise RuntimeError(f"marker {prefix!r} not seen; output tail:\n" + "\n".join(self.lines[-15:]))

    def signal_group(self, sig):
        try:
            os.killpg(self.pgid, sig)
        except (ProcessLookupError, PermissionError):  # group already gone (macOS: EPERM on a zombie)
            pass

    def dispose(self):
        self.signal_group(signal.SIGKILL)
        try:
            self.p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass


def project_residue(project):
    lab = f"label=com.docker.compose.project={project}"
    out = []
    for kind, cmd in (("container", ["docker", "ps", "-a"]), ("volume", ["docker", "volume", "ls"]),
                      ("network", ["docker", "network", "ls"])):
        r = sh(cmd + ["--filter", lab, "--format", "{{.Name}}" if kind == "volume" else ("{{.Names}} {{.Status}}" if kind == "container" else "{{.Name}}")])
        out += [f"{kind}: {x}" for x in r.stdout.split("\n") if x.strip()]
    return out


def baseline_residue(tmp):
    out = []
    wts = sh(["git", "worktree", "list"]).stdout
    out += [f"worktree: {x}" for x in wts.split("\n") if tmp in x]
    if os.path.exists(tmp):
        out.append(f"tmpdir: {tmp}")
    return out


def remove_project(project):
    lab = f"label=com.docker.compose.project={project}"
    ids = sh(["docker", "ps", "-aq", "--filter", lab]).stdout.split()
    if ids:
        sh(["docker", "rm", "-f", "-v"] + ids)
    for kind in ("volume", "network"):
        names = sh(["docker", kind, "ls", "-q", "--filter", lab]).stdout.split()
        if names:
            sh(["docker", kind, "rm"] + names)


def remove_baseline(tmp):
    wt = os.path.join(tmp, "wt")
    for nm in ["node_modules"] + [f"apps/{a}/node_modules" for a in os.listdir(os.path.join(ROOT, "apps"))]:
        pth = os.path.join(wt, nm)
        if os.path.islink(pth):
            os.unlink(pth)  # symlink only, never the target
    if os.path.exists(wt):
        sh(["git", "worktree", "remove", "--force", wt])
    if os.path.exists(tmp) and os.path.basename(tmp).startswith("renovix-check-baseline-"):
        shutil.rmtree(tmp, ignore_errors=True)


def leftover_procs(pgid, needles):
    """Processes still in the run's process group, or whose command line names one of its resources."""
    out = []
    for line in sh(["ps", "-A", "-o", "pid=,pgid=,command="]).stdout.split("\n"):
        parts = line.split(None, 2)
        if len(parts) < 3 or parts[0] == str(os.getpid()) or "check-sigint-test" in parts[2]:
            continue
        if parts[1] == str(pgid) or any(n in parts[2] for n in needles if n):
            out.append(line.strip())
    return out


def phase(name, marker, extra=0, second=False, closepipe=False):
    """Start `bun run check`, wait for the marker, group-SIGINT it (optionally twice / with stdout closed)."""
    r, project, tmp = Run(), None, None
    try:
        line = r.wait_for(marker)
        if name == "test":
            project = re.search(r"renovix-check-\d+-[a-z0-9]+", line).group(0)
        else:
            tmp = os.path.dirname(re.search(r" in (\S+)$", line).group(1))
        time.sleep(extra)
        if closepipe:
            r.p.stdout.close()  # the reader side goes away: writes by the check now fail with EPIPE
        print(f"  {project or tmp}: group SIGINT" + (" (stdout closed)" if closepipe else ""))
        r.signal_group(signal.SIGINT)
        if second:
            time.sleep(0.5)
            r.signal_group(signal.SIGINT)
            print("  second group SIGINT sent during cleanup")
        try:
            r.p.wait(timeout=EXIT_WAIT)
        except subprocess.TimeoutExpired:
            r.signal_group(signal.SIGKILL)
            r.p.wait()
        print(f"  exit code {r.p.returncode}")
        res = []
        if second:
            time.sleep(1)  # let the reader thread drain the output
            if not any("cleanup in progress" in x for x in r.lines):
                res.append("second SIGINT did not land during the cleanup (no 'cleanup in progress' line)")
            else:
                print("  check printed: cleanup in progress (second SIGINT landed during the cleanup)")
        for when in ("at return", "+20s"):
            if when == "+20s":
                time.sleep(20)
            found = (project_residue(project) if project else baseline_residue(tmp))
            found += [f"process: {x}" for x in leftover_procs(r.pgid, [project, tmp])]
            res += [f"[{when}] {x}" for x in found]
        return res
    finally:
        r.dispose()
        if project:
            remove_project(project)
        if tmp:
            remove_baseline(tmp)


TEST = "Test database: own compose project renovix-check-"
BASE = "Baseline: origin/main"


def scenario_test():
    return phase("test", TEST, extra=2.5)


def scenario_baseline():
    return phase("baseline", BASE, extra=3)


def scenario_test_double():
    return phase("test", TEST, extra=2.5, second=True)


def scenario_baseline_double():
    return phase("baseline", BASE, extra=3, second=True)


def scenario_test_closed():
    return phase("test", TEST, extra=2.5, closepipe=True)


def scenario_baseline_closed():
    return phase("baseline", BASE, extra=3, closepipe=True)


SCENARIOS = {
    "test": scenario_test,
    "baseline": scenario_baseline,
    "test-double": scenario_test_double,
    "baseline-double": scenario_baseline_double,
    "test-closed": scenario_test_closed,
    "baseline-closed": scenario_baseline_closed,
}


def main():
    names = sys.argv[1:] or list(SCENARIOS)
    failed = False
    for n in names:
        print(f"== {n} ==")
        try:
            res = SCENARIOS[n]()
        except Exception as e:  # noqa: BLE001
            res = [f"scenario error: {e}"]
        print(f"{'FAIL' if res else 'PASS'}  {n}" + ("".join(f"\n    residue {x}" for x in res)))
        failed = failed or bool(res)
    sys.exit(1 if failed else 0)


main()
