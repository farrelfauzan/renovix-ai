interface SignInSecurityRowProps {
  label: string;
  detail: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
}

/** RNX-78: one row of Settings > Sign-in and security (artboard UserSettings): what it is, its state, its button. */
export function SignInSecurityRow({ label, detail, action, children }: SignInSecurityRowProps) {
  return (
    <div className="flex flex-col gap-3 border-t py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">{label}</span>
          <span className="text-[13px] text-muted-foreground">{detail}</span>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
