/**
 * Stylized hardscape for the garden (Berkner Park reference), traced loosely
 * from the plat survey: a corner lot with a curved frontage (NW), a chamfered
 * SW corner, a street (S), and an alley (E). Drawn in a 0..1000 viewBox to
 * match the normalized (×1000) zone coordinates.
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
      <text x="472" y="505" fontSize="26" fill="#7a6a44" textAnchor="middle" fontFamily="var(--font-hand), cursive">house</text>
      {/* Covered porch (west of house) */}
      <rect x="258" y="430" width="44" height="120" rx="4" fill="#d8cbb0" stroke="#9c8567" strokeWidth={2} />
      {/* Concrete patio (SE of house) */}
      <rect x="560" y="600" width="150" height="95" rx="4" fill="#ded6c4" stroke="#bcae8e" strokeWidth={2} />

      {/* Pool & spa (east, near alley) */}
      <rect x="715" y="430" width="150" height="175" rx="40" fill="#7fb9c6" stroke="#4f93a0" strokeWidth={3} />
      <circle cx="700" cy="640" r="26" fill="#7fb9c6" stroke="#4f93a0" strokeWidth={3} />

      {/* Street labels */}
      <text x="70" y="470" fontSize="34" fill="#7a6a44" transform="rotate(-78 70 470)" fontFamily="var(--font-hand), cursive">
        Eastview Cir
      </text>
      <text x="430" y="955" fontSize="34" fill="#7a6a44" fontFamily="var(--font-hand), cursive">
        Baltimore Drive
      </text>
      <text x="930" y="490" fontSize="24" fill="#9c8567" transform="rotate(90 930 490)" fontFamily="var(--font-hand), cursive">
        alley
      </text>
    </g>
  );
}
