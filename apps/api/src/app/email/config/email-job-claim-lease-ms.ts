/**
 * How long a claim keeps an email job in "sending" to itself, in ms (RNX-352). A job still in "sending" when its lease
 * has ended (its container died before marking it) is claimed again by any container. The scheduler claims 5 jobs and
 * sends them one after another, so the lease covers the whole batch: the SMTP transport sets no timeouts, so a send to an
 * unreachable server fails after nodemailer's defaults (DNS 30 s + connection 2 min + greeting 30 s = 3 min), and 5 such
 * sends end within 15 min; a healthy batch takes seconds. A mail lost with its container is sent again within about
 * 15 min. A send that outlasts the lease (a server that stalls mid-conversation) can be sent twice: accepted, delivery is
 * at least once.
 */
export const EMAIL_JOB_CLAIM_LEASE_MS = 15 * 60 * 1000;
