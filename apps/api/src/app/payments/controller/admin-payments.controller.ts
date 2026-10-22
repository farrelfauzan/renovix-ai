import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, StreamableFile } from "@nestjs/common";
import { Readable } from "node:stream";
import { Access } from "../../../common/decorators/access.decorator";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";
import { AdminAudit } from "../../admin-auth/decorator/admin-audit.decorator";
import type { AdminRequest } from "../../admin-auth/types/admin-request";
import type { AuditedAdminRequest } from "../../admin-auth/types/audited-admin-request";
import { ADMIN_PAYMENT_PERMISSIONS } from "../config/admin-payment-permissions";
import { ConfirmOrderBodyDto } from "../dto/confirm-order-body.dto";
import { MarkRefundedBodyDto } from "../dto/mark-refunded-body.dto";
import { OrdersDayQueryDto } from "../dto/orders-day-query.dto";
import { OrdersListQueryDto } from "../dto/orders-list-query.dto";
import { AdminPaymentsService } from "../service/admin-payments.service";
import type { AdminOrderDay } from "../types/admin-order-day";
import type { ConfirmOutcomeView } from "../types/confirm-outcome-view";
import type { UnmatchedPaymentView } from "../types/unmatched-payment-view";

/**
 * Manual payment reconciliation (RNX-35, AC19, AC20) under /api/v1/admin/payments. Reading a day and its CSV need
 * ADMIN_PAYMENT_PERMISSIONS.read; "confirm from provider" and "mark unmatched as refunded" need
 * ADMIN_PAYMENT_PERMISSIONS.write and a re-authentication within REAUTH_WINDOW_MINUTES. The permissions are chosen in
 * config/admin-payment-permissions.ts only. Every action writes an audit row.
 */
@Controller("admin/payments")
export class AdminPaymentsController {
  constructor(private readonly payments: AdminPaymentsService) {}

  /** The Jakarta day's counts by state and flag, its orders (one state or flag with `state`) and unmatched payments. */
  @Get("orders")
  @Access({ auth: ["staff"], permissions: ADMIN_PAYMENT_PERMISSIONS.read })
  listOrders(@Query() query: unknown): Promise<AdminOrderDay> {
    const parsed = OrdersListQueryDto.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.payments.listDay(parsed.data.day, parsed.data.state ?? null);
  }

  /** The Jakarta day as CSV (orderId, providerRef, amount, timestamps, status, flags); the export is audited. */
  @Get("orders/export")
  @Access({ auth: ["staff"], permissions: ADMIN_PAYMENT_PERMISSIONS.read })
  @AdminAudit({ resource: "payment_orders", action: "export" })
  @Header("Cache-Control", "no-store")
  async exportOrders(@Query() query: unknown, @Req() req: AuditedAdminRequest): Promise<StreamableFile> {
    const parsed = OrdersDayQueryDto.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { csv, change } = await this.payments.exportDay(parsed.data.day);
    req.audit.record(change);
    return new StreamableFile(Readable.from([csv]), { type: "text/csv; charset=utf-8", disposition: `attachment; filename="payments-${parsed.data.day}.csv"` });
  }

  /** Asks the provider again for one order and applies the answer through the same settlement path (a matching settlement grants once). */
  @Post("orders/:id/confirm")
  @HttpCode(200)
  @Access({ auth: ["staff"], permissions: ADMIN_PAYMENT_PERMISSIONS.write, reauth: true })
  @AdminAudit({ exempt: true, reason: "the provider status check must run outside a transaction; the handler writes its own audit row" })
  async confirmFromProvider(@Param("id") id: string, @Body() body: unknown, @Req() req: AdminRequest): Promise<ConfirmOutcomeView> {
    const parsed = ConfirmOrderBodyDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    return this.payments.confirmFromProvider({ adminId: req.admin.adminId, orderId: id, reason: parsed.data.reason, requestId: req.id });
  }

  /** Marks an unmatched payment refunded (the money went back outside the API) with the admin's note. */
  @Post("unmatched/:id/refunded")
  @HttpCode(200)
  @Access({ auth: ["staff"], permissions: ADMIN_PAYMENT_PERMISSIONS.write, reauth: true })
  @AdminAudit({ resource: "payment_unmatched", action: "mark_refunded" })
  async markRefunded(@Param("id") id: string, @Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<UnmatchedPaymentView> {
    const parsed = MarkRefundedBodyDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const { result, change } = await this.payments.markUnmatchedRefunded({ adminId: req.admin.adminId, unmatchedId: id, note: parsed.data.note }, req.audit.tx);
    req.audit.record(change);
    return result;
  }
}
