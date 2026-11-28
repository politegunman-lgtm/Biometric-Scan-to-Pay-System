"use client";

import { useApp } from "./AppProvider";
import { MerchantAvatar } from "./MerchantAvatar";
import { Icon } from "./icons";
import { CATEGORY_META, STATUS_META, money, timeLabel } from "@/lib/format";
import type { Txn } from "@/lib/types";

export function TxnRow({ txn, showDay = false }: { txn: Txn; showDay?: boolean }) {
  const { state, setActiveTxn } = useApp();
  const merchant = state?.merchants.find((m) => m.id === txn.merchantId);
  const status = STATUS_META[txn.status];
  const positive = txn.status === "reversed";

  return (
    <button type="button" className="list-row" onClick={() => setActiveTxn(txn)}>
      <MerchantAvatar name={txn.merchantName} hue={merchant?.logoHue ?? 42} />
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="row-between" style={{ gap: 8 }}>
          <span className="strong truncate" style={{ fontSize: 13, fontWeight: 500 }}>
            {txn.merchantName}
          </span>
          <span className={`amount ${positive ? "pos" : "neg"}`}>
            {positive ? "+" : ""}
            {money(txn.amountXAF, { suffix: false })}
          </span>
        </span>
        <span className="row-between" style={{ gap: 8, marginTop: 1 }}>
          <span className="txn-note truncate">
            {showDay && <>{txn.createdAt.slice(5, 10).replace("-", "/")} <span className="sep">·</span> </>}
            {CATEGORY_META[txn.category].label}
            <span className="sep">·</span>
            {timeLabel(txn.createdAt)}
            {txn.offline && (
              <>
                <span className="sep">·</span>
                <Icon name="cloud" size={11} />
              </>
            )}
          </span>
          {txn.status !== "settled" ? (
            <span className={`badge ${status.tone}`} style={{ height: 18, fontSize: 9.5 }}>
              {status.label}
            </span>
          ) : txn.risk.score >= 30 ? (
            <span className="badge warn" style={{ height: 18, fontSize: 9.5 }}>
              reviewed
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
