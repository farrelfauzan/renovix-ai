/** True unless both ends of an audit log time range are given and `from` is not before `to` (RX-164). */
export const hasValidRange = (filters: { readonly from?: Date; readonly to?: Date }): boolean =>
  !filters.from || !filters.to || filters.from < filters.to;
