/**
 * Stylized hardscape for 1105 Eastview Cir, traced loosely from the plat survey:
 * corner lot with a curved Eastview Cir frontage (NW), a chamfered SW corner,
 * Baltimore Drive (S), and the alley (E). Drawn in a 0..1000 viewBox to match
 * the normalized (×1000) zone coordinates. Refined later via the shape editor.
 */
export default function BaseMap() {
  return (
    <g>
      {/* Lot ground */}
      <path
        d="M 180 110
           L 905 150
           L 905 815
           L 250 900
           L 120 815
           Q 60 560 180 110 Z"
        fill="#efe7d3"
        stroke="#b9a87f"
        strokeWidth={4}
      />

      {/* Alley (east strip) */}
      <path d="M 905 150 L 955 160 L 955 805 L 905 815 Z" fill="#e3dac3" stroke="#cbb994" strokeWidth={2} />

      {/* House — One Story Brick */}
      <rect x="300" y="395" width="345" height="205" rx="6" fill="#cdb79b" stroke="#9c8567" strokeWidth={3} />
      <text x="472" y="505" fontSize="16" fill="#7a6a44" textAnchor="middle">house</text>
      {/* Covered porch (west of house) */}
      <rect x="258" y="430" width="44" height="120" rx="4" fill="#d8cbb0" stroke="#9c8567" strokeWidth={2} />
      {/* Concrete patio (SE of house) */}
      <rect x="560" y="600" width="150" height="95" rx="4" fill="#ded6c4" stroke="#bcae8e" strokeWidth={2} />

      {/* Pool & spa (east, near alley) */}
      <rect x="715" y="430" width="150" height="175" rx="40" fill="#7fb9c6" stroke="#4f93a0" strokeWidth={3} />
      <circle cx="700" cy="640" r="26" fill="#7fb9c6" stroke="#4f93a0" strokeWidth={3} />

      {/* Street labels */}
      <text x="70" y="470" fontSize="22" fill="#7a6a44" transform="rotate(-78 70 470)" fontStyle="italic">
        Eastview Cir
      </text>
      <text x="430" y="950" fontSize="22" fill="#7a6a44" fontStyle="italic">
        Baltimore Drive
      </text>
      <text x="930" y="490" fontSize="16" fill="#9c8567" transform="rotate(90 930 490)">
        alley
      </text>
    </g>
  );
}
