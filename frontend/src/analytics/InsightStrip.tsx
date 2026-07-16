import type { CostAnalyticsResponse } from "../api/types";
import {
  chartModels,
  displayModelName,
  formatSignedUsd,
  formatTokens,
  formatUsd,
  largestSpike,
  topModelSpendSharePct,
} from "./chartGeometry";

interface Props {
  payload: CostAnalyticsResponse;
  selectedSpikeBucket?: string | null;
  onSelectSpike?: (bucket: string) => void;
}

export default function InsightStrip({ payload, selectedSpikeBucket = null, onSelectSpike }: Props) {
  const cache = payload.cache_economics;
  const spike = largestSpike(payload);
  const partial = payload.meta.costs_partial;
  const spikeSelected = Boolean(spike && selectedSpikeBucket === spike.bucket);
  const topModel = [...chartModels(payload.by_model)].sort((a, b) => b.usd - a.usd)[0];
  const topShare = topModelSpendSharePct(payload);
  const cacheLabel = partial
    ? "Cache comparison unavailable"
    : !payload.meta.available
    ? "Cache pricing unavailable"
    : cache.net_savings_usd > 0
      ? "Estimated API-equivalent cache savings"
      : cache.net_savings_usd < 0
        ? "Estimated API-equivalent cache penalty"
        : "Estimated API-equivalent cache difference";

  return (
    <div className="cost-insight-strip" aria-label="Cost insights">
      <div className="cost-insight">
        <span>{cacheLabel}</span>
        <b>{partial ? "Partial pricing" : payload.meta.available ? formatUsd(Math.abs(cache.net_savings_usd)) : "Unavailable"}</b>
        <small>
          {partial
            ? `excludes ${payload.meta.unpriced_models.map(displayModelName).join(", ")}`
            : !payload.meta.available
            ? "price table missing"
            : cache.cache_read_tokens > 0
              ? `${formatTokens(cache.cache_read_tokens)} reused vs uncached input`
              : "no cache reuse"}
        </small>
      </div>
      {spike && !partial && onSelectSpike ? (
        <button
          type="button"
          className="cost-insight"
          aria-pressed={spikeSelected}
          aria-label={`${spikeSelected ? "Hide" : "Show"} largest spike sessions for ${spike.bucket}`}
          style={{ textAlign: "left" }}
          onClick={() => onSelectSpike(spike.bucket)}
        >
          <span>Largest spike</span>
          <b>{`${spike.bucket} ${formatSignedUsd(spike.delta_usd)}`}</b>
          <small>
            {spikeSelected
              ? `${spike.sessions.length} session${spike.sessions.length === 1 ? "" : "s"} shown`
              : `${formatUsd(spike.total_usd)} total - inspect sessions`}
          </small>
        </button>
      ) : (
        <div className="cost-insight">
          <span>{partial ? "Spike detection suppressed" : "Largest spike"}</span>
          <b>{partial ? "Partial pricing" : spike ? `${spike.bucket} ${formatSignedUsd(spike.delta_usd)}` : "None qualified"}</b>
          <small>
            {partial
              ? "requires complete model pricing"
              : spike
                ? `${formatUsd(spike.total_usd)} total`
                : "no evidence-qualified increase"}
          </small>
        </div>
      )}
      <div className="cost-insight">
        <span>{partial ? "Model share unavailable" : "Top model"}</span>
        <b>{partial ? "Partial pricing" : topModel ? `${topShare}%` : "None"}</b>
        <small>
          {topModel
            ? partial
              ? `${displayModelName(topModel.model)} leads priced spend only`
              : `${displayModelName(topModel.model)} spend share`
            : "no model spend"}
        </small>
      </div>
    </div>
  );
}
