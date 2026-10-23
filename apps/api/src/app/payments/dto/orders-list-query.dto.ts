import { z } from "zod";
import { ORDER_LIST_STATES } from "../types/order-list-state";
import { OrdersDayQueryDto } from "./orders-day-query.dto";

/** GET /admin/payments/orders (RNX-35, AC19): the Jakarta day, and optionally one state or flag to list. */
export const OrdersListQueryDto = OrdersDayQueryDto.extend({ state: z.enum(ORDER_LIST_STATES).optional() });
export type OrdersListQueryDto = z.infer<typeof OrdersListQueryDto>;
