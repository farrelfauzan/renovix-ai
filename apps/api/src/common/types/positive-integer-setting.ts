/** An optional numeric setting read from the environment (RX-160). */
export interface PositiveIntegerSetting {
  /** The variable's name, used in the error. */
  name: string;
  /** Its raw value; unset or empty means "use the fallback". */
  value: string | undefined;
  fallback: number;
}
