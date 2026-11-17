/**
 * Gráficos do painel em SVG puro (sem biblioteca): linha de uma série e barras horizontais.
 * Uma série só → sem legenda (o título do cartão diz o que é); tooltip nativo em cada ponto.
 */

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('pt-BR');
const ddmm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * mag * 4 >= v) ?? 10;
  return step * mag * 4;
}

export function LineChart({
  data,
  label,
}: {
  data: Array<{ day: string; views: number }>;
  label: string;
}) {
  const W = 640;
  const H = 200;
  const pad = { l: 40, r: 44, t: 12, b: 24 };
  const max = niceMax(Math.max(...data.map((d) => d.views), 0));
  const x = (i: number) => pad.l + (i / Math.max(1, data.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = data
    .map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.views).toFixed(1)}`)
    .join('');
  const area = `${path}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const last = data.at(-1);
  const ticks = [0, max / 2, max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={y(t)}
            y2={y(t)}
            stroke="currentColor"
            className="text-night-700"
            strokeWidth={1}
          />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="fill-haze-500 text-[10px]">
            {compact.format(t)}
          </text>
        </g>
      ))}
      <path d={area} className="fill-neon-cyan/10" />
      <path
        d={path}
        fill="none"
        className="stroke-neon-cyan"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {data.map((d, i) => (
        <circle
          key={d.day}
          cx={x(i)}
          cy={y(d.views)}
          r={9}
          fill="transparent"
          className="cursor-default"
        >
          <title>{`${ddmm(d.day)}: ${full.format(d.views)} visualizações`}</title>
        </circle>
      ))}
      {last ? (
        <>
          <circle
            cx={x(data.length - 1)}
            cy={y(last.views)}
            r={4}
            className="fill-neon-cyan stroke-night-900"
            strokeWidth={2}
          />
          <text
            x={x(data.length - 1) + 8}
            y={y(last.views) + 4}
            className="fill-white text-[11px] font-semibold"
          >
            {compact.format(last.views)}
          </text>
        </>
      ) : null}
      {[0, Math.floor((data.length - 1) / 2), data.length - 1].map((i) =>
        data[i] ? (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
            className="fill-haze-500 text-[10px]"
          >
            {ddmm(data[i].day)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function BarList({
  rows,
  unit = 'visualizações',
  testId,
}: {
  rows: Array<{ label: string; value: number; note?: string }>;
  unit?: string;
  testId?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5" data-testid={testId}>
      {rows.map((r) => (
        <li
          key={r.label}
          title={`${r.label}: ${full.format(r.value)} ${unit}${r.note ? ` · ${r.note}` : ''}`}
        >
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-haze-300">{r.label}</span>
            <span className="shrink-0 font-semibold text-white">
              {compact.format(r.value)}
              {r.note ? <span className="ml-1 font-normal text-haze-500">· {r.note}</span> : null}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-night-800">
            <div
              className="h-2 rounded-full bg-neon-cyan"
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
