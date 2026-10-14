// Animated SVG diagrams for the docs. Colours come from CSS variables, so they follow the theme;
// motion is CSS only, so prefers-reduced-motion stops it.

type Box = { id: string; x: number; y: number; w?: number; label: string; sub?: string; tone?: "good" | "bad" | "warn" | "accent" };

function Node({ box, delay }: { box: Box; delay: number }) {
  const w = box.w ?? 150;
  return (
    <g className={`dg-node ${box.tone ?? ""}`} style={{ animationDelay: `${delay}ms` }}>
      <rect x={box.x} y={box.y} width={w} height={44} rx={9} />
      <text x={box.x + w / 2} y={box.y + (box.sub ? 19 : 27)} textAnchor="middle" className="dg-label">
        {box.label}
      </text>
      {box.sub && (
        <text x={box.x + w / 2} y={box.y + 34} textAnchor="middle" className="dg-sub">
          {box.sub}
        </text>
      )}
    </g>
  );
}

function Edge({ d, label, lx, ly, tone, delay = 0 }: { d: string; label?: string; lx?: number; ly?: number; tone?: string; delay?: number }) {
  return (
    <g className={`dg-edge ${tone ?? ""}`}>
      <path d={d} className="dg-line" markerEnd="url(#dg-arrow)" />
      <path d={d} className="dg-flow" style={{ animationDelay: `${delay}ms` }} />
      {label && lx !== undefined && ly !== undefined && (
        <text x={lx} y={ly} textAnchor="middle" className="dg-edge-label">
          {label}
        </text>
      )}
    </g>
  );
}

function Defs() {
  return (
    <defs>
      <marker id="dg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" className="dg-arrowhead" />
      </marker>
    </defs>
  );
}

export function LifecycleDiagram() {
  const boxes: Box[] = [
    { id: "ps", x: 16, y: 24, label: "PENDING_SNAPSHOT", sub: "register · sponsor_review", w: 168 },
    { id: "pr", x: 236, y: 24, label: "PENDING_REVIEW", sub: "pins stored", w: 160 },
    { id: "ac", x: 448, y: 24, label: "ACTIVE", sub: "judged SAFE", tone: "good", w: 130 },
    { id: "sl", x: 630, y: 24, label: "SLASHED", sub: "bond paid out", tone: "bad", w: 120 },
    { id: "rj", x: 236, y: 168, label: "REJECTED", sub: "POISONED at review", tone: "bad", w: 160 },
    { id: "st", x: 448, y: 168, label: "STALE", sub: "drift settled", tone: "warn", w: 130 },
    { id: "ex", x: 630, y: 168, label: "EXITING", sub: "7-day delay", w: 120 },
    { id: "ed", x: 630, y: 282, label: "EXITED", sub: "bond claimable", w: 120 },
  ];
  return (
    <figure className="dg" aria-label="Server lifecycle: register, snapshot, review, then active; drift makes it stale, poison slashes it, exits return the bond.">
      <svg viewBox="0 0 766 344" role="img">
        <Defs />
        <Edge d="M184 46 H232" label="snapshot" lx={208} ly={38} delay={0} />
        <Edge d="M396 46 H444" label="review" lx={420} ly={38} delay={300} />
        <Edge d="M578 46 H626" label="poisoned · unstable" lx={604} ly={16} tone="bad" delay={600} />
        <Edge d="M316 68 V164" label="poisoned" lx={350} ly={120} tone="bad" delay={450} />
        <Edge d="M500 68 V164" label="drift" lx={482} ly={120} tone="warn" delay={750} />
        <Edge d="M448 190 C 420 150, 380 110, 380 70" label="re-pin" lx={412} ly={160} delay={1050} />
        <Edge d="M578 190 H626" label="exit" lx={602} ly={182} delay={1200} />
        <Edge d="M690 212 V278" label="7 days" lx={720} ly={250} delay={1350} />
        {boxes.map((box, index) => (
          <Node key={box.id} box={box} delay={index * 110} />
        ))}
      </svg>
      <figcaption>Every arrow is a contract call that validators decide. A settle never moves a server out of SLASHED, EXITED or REJECTED.</figcaption>
    </figure>
  );
}

export function ConsensusDiagram() {
  const validators = [0, 1, 2, 3, 4];
  return (
    <figure className="dg" aria-label="Five validators each fetch the MCP server, hash it with TBCM-1 and must derive the same root before anything is stored.">
      <svg viewBox="0 0 766 300" role="img">
        <Defs />
        <g className="dg-node accent">
          <rect x={18} y={118} width={150} height={64} rx={12} />
          <text x={93} y={145} textAnchor="middle" className="dg-label">
            MCP server
          </text>
          <text x={93} y={163} textAnchor="middle" className="dg-sub">
            initialize · tools/list
          </text>
        </g>
        {validators.map((i) => {
          const y = 22 + i * 56;
          return (
            <g key={i}>
              <Edge d={`M168 150 C 230 150, 250 ${y + 22}, 300 ${y + 22}`} delay={i * 140} />
              <g className={`dg-node ${i === 0 ? "good" : ""}`} style={{ animationDelay: `${200 + i * 120}ms` }}>
                <rect x={300} y={y} width={150} height={44} rx={9} />
                <text x={375} y={y + 19} textAnchor="middle" className="dg-label">
                  {i === 0 ? "Leader" : `Validator ${i}`}
                </text>
                <text x={375} y={y + 34} textAnchor="middle" className="dg-sub">
                  fetch → TBCM-1 → sha256
                </text>
              </g>
              <Edge d={`M450 ${y + 22} H492`} delay={600 + i * 140} />
              <g className="dg-hash" style={{ animationDelay: `${900 + i * 160}ms` }}>
                <rect x={496} y={y + 8} width={112} height={28} rx={14} />
                <text x={552} y={y + 26} textAnchor="middle">
                  99224815…93f3
                </text>
              </g>
              <Edge d={`M608 ${y + 22} C 640 ${y + 22}, 640 150, 664 150`} delay={1300 + i * 120} />
            </g>
          );
        })}
        <g className="dg-node good dg-verdict">
          <rect x={664} y={122} width={92} height={56} rx={12} />
          <text x={710} y={146} textAnchor="middle" className="dg-label">
            equal
          </text>
          <text x={710} y={164} textAnchor="middle" className="dg-sub">
            → stored
          </text>
        </g>
      </svg>
      <figcaption>
        Nothing is uploaded and nobody is trusted: each validator runs the MCP handshake itself. If one derives a different root, the transaction is not accepted.
      </figcaption>
    </figure>
  );
}

export function ChallengeDiagram() {
  const stages: Box[] = [
    { id: "f", x: 16, y: 40, label: "FILED", sub: "stake 0.5 or 1 GEN", w: 150 },
    { id: "o", x: 216, y: 40, label: "OBSERVED", sub: "drift only", w: 150 },
    { id: "j", x: 416, y: 40, label: "JUDGED", sub: "two readings each", w: 150 },
    { id: "s", x: 616, y: 40, label: "SETTLED", sub: "payout table", tone: "good", w: 134 },
  ];
  const branches = [
    { x: 291, y: 140, text: "MATCH · KNOWN", tone: "good" },
    { x: 291, y: 166, text: "DIFFERS → judge", tone: "warn" },
    { x: 291, y: 192, text: "UNSTABLE · UNPINNED", tone: "bad" },
    { x: 291, y: 218, text: "UNREACHABLE → refund", tone: "" },
    { x: 491, y: 140, text: "SAFE", tone: "good" },
    { x: 491, y: 166, text: "UNCLEAR", tone: "warn" },
    { x: 491, y: 192, text: "POISONED → slash", tone: "bad" },
  ];
  return (
    <figure className="dg" aria-label="A challenge moves from filed to observed to judged to settled; anyone can push each step.">
      <svg viewBox="0 0 766 240" role="img">
        <Defs />
        <Edge d="M166 62 H212" delay={0} />
        <Edge d="M366 62 H412" delay={300} />
        <Edge d="M566 62 H612" delay={600} />
        <Edge d="M90 84 C 90 120, 640 120, 683 86" tone="muted" label="content challenges skip observe" lx={384} ly={112} delay={900} />
        {stages.map((box, index) => (
          <Node key={box.id} box={box} delay={index * 140} />
        ))}
        {branches.map((branch, index) => (
          <g key={branch.text} className={`dg-pill ${branch.tone}`} style={{ animationDelay: `${700 + index * 90}ms` }}>
            <text x={branch.x} y={branch.y} textAnchor="middle">
              {branch.text}
            </text>
          </g>
        ))}
        <circle className="dg-token" r={6} cx={16} cy={62} />
      </svg>
      <figcaption>Each step is its own transaction, and anyone can send it: a stalled challenge can always be pushed forward or expired.</figcaption>
    </figure>
  );
}
