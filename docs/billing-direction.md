# Billing direction

**Direction, not implemented yet.** This is the agreed product direction. The code today still uses plans and invitation codes (Stripe is disabled), not credits. Details, PRDs and decisions live in Notion: <https://app.notion.com/p/3f352ed08ee2811daafefab59f5512bb>.

## Agreed direction

- Renovix AI is a credit-based platform for companies and individuals in Indonesia.
- Cheap Chinese models (DeepSeek, Kimi, GLM, Qwen) set the base price. Claude and OpenAI models are premium tiers.
- Payments: GoPay and QRIS only, in rupiah, through Xendit (decisions D4, D22). Refunds also go through Xendit (D24).
- An Enterprise package: 100 seats per company and a shared credit pool.
- A credit ledger is planned (RX-22). Every model call will go through it.

## Not decided here

Prices, credit amounts and multipliers are in the Notion PRDs and the decision log, not in this repo. The old pricing analysis (`OPENROUTER_PRICING_ANALYSIS.md`) and quota plan (`QUOTA_STRATEGY.md`) predate this direction and are inputs only.
