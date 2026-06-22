/**
 * Survey-traced hardscape for the garden (Berkner Park reference), reconstructed
 * from the plat survey's red property line: a corner lot (~1.56:1) with a curved
 * frontage (SW), a chamfered SE corner, a street (S), and an alley (E). The
 * frontage parkway strip outside the property line is included — beds there
 * (e.g. the hellstrip) sit between the boundary and the sidewalk. Drawn in a
 * 0..1000 viewBox to match the normalized (×1000) zone coordinates.
 */
const hand = "var(--font-hand), cursive";

export default function BaseMap() {
  return (
    <g>
      {/* Paper ground */}
      <rect x="0" y="0" width="1000" height="1000" fill="#f3ead4" />

      {/* Streets (beyond the frontage) */}
      <path
        d="M40,250 C30,560 60,820 150,940 L70,980 C-20,840 -40,560 -30,250 Z"
        fill="#e6ddc8"
        stroke="#cbb994"
        strokeWidth={2}
      />
      <rect x="120" y="900" width="900" height="90" fill="#e6ddc8" stroke="#cbb994" strokeWidth={2} />

      {/* Alley (east) */}
      <path d="M918,235 L965,245 L965,735 L918,725 Z" fill="#e3dac3" stroke="#cbb994" strokeWidth={2} />

      {/* Frontage parkway / planting strip (outside the property line) */}
      <path
        d="M150,690 C150,742 168,768 235,778 C360,798 660,795 878,762 L905,860
           C660,900 320,905 210,880 C120,860 92,800 92,690 Z"
        fill="#ede6cf"
      />

      {/* Sidewalk (4' conc) through the parkway */}
      <path
        d="M120,690 C120,760 150,800 240,822 C380,852 690,848 902,812"
        fill="none"
        stroke="#d8cdb2"
        strokeWidth={10}
      />

      {/* PROPERTY BOUNDARY (the red survey line) */}
      <path
        d="M150,250 L905,235 L918,725 L878,762
           C660,795 360,798 235,778 C168,768 150,742 150,690 Z"
        fill="#efe7d3"
        stroke="#b85c4a"
        strokeWidth={4}
      />

      {/* House (One Story Brick) */}
      <path
        d="M386,299 L688,299 L688,520 L603,520 L603,574 L386,574 Z"
        fill="#cdb79b"
        stroke="#9c8567"
        strokeWidth={3}
      />
      <text x="500" y="430" fontSize={26} fill="#7a6a44" textAnchor="middle" fontFamily={hand}>
        house
      </text>

      {/* Covered porch (west of house) */}
      <rect x="353" y="398" width="33" height="96" rx="4" fill="#d8cbb0" stroke="#9c8567" strokeWidth={2} />

      {/* A/C pad + shed (north of house) */}
      <rect x="450" y="300" width="22" height="16" fill="#ded6c4" stroke="#bcae8e" strokeWidth={1.5} />
      <rect x="512" y="284" width="26" height="18" fill="#ded6c4" stroke="#bcae8e" strokeWidth={1.5} />

      {/* Conc patio (between house and pool) */}
      <rect x="603" y="406" width="131" height="88" rx="3" fill="#ded6c4" stroke="#bcae8e" strokeWidth={2} />

      {/* Spa (octagon) */}
      <polygon
        points="720,388 736,380 752,388 758,404 752,420 736,428 720,420 714,404"
        fill="#7fb9c6"
        stroke="#4f93a0"
        strokeWidth={2.5}
      />

      {/* Pool (kidney) */}
      <path
        d="M775,285 C840,280 905,300 905,360 C905,415 855,440 805,438
           C775,437 762,415 768,392 C758,378 760,350 760,330 C760,305 760,288 775,285 Z"
        fill="#7fb9c6"
        stroke="#4f93a0"
        strokeWidth={3}
      />

      {/* Conc driveway (SE, to alley) */}
      <rect x="747" y="500" width="163" height="165" rx="3" fill="#ded6c4" stroke="#bcae8e" strokeWidth={2} />

      {/* Wood fence (SE exterior) */}
      <path d="M745,665 L905,690" fill="none" stroke="#a9895f" strokeWidth={3} strokeDasharray="8 5" />
    </g>
  );
}
