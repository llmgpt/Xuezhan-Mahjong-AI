import { labelOf, suitOf, type Tile } from "../game/tiles";

// 牌面按常见实体麻将的排布绘制：万为黑字数字加红“萬”，筒与条按标准位置和配色。
// 每次改动需对照实体牌或参考图目视确认，测试只能保证结构，不能保证“认得出”。
const GREEN = "#13804a";
const RED = "#c62f38";
const BLACK = "#1e1e1e";

const characters = ["一", "二", "三", "四", "伍", "六", "七", "八", "九"];

type Coin = [x: number, y: number, color: string];

const g = GREEN;
const r = RED;
const k = BLACK;

// 2～9 筒：[x, y, 颜色]，以及圆半径。1 筒单独绘制。
const tongLayouts: Record<number, { radius: number; coins: Coin[] }> = {
  2: {
    radius: 14.5,
    coins: [
      [32, 24, g],
      [32, 64, k],
    ],
  },
  3: {
    radius: 11.5,
    coins: [
      [15, 17, g],
      [32, 44, r],
      [49, 71, k],
    ],
  },
  4: {
    radius: 12.5,
    coins: [
      [18, 23, g],
      [46, 23, k],
      [18, 65, k],
      [46, 65, g],
    ],
  },
  5: {
    radius: 11,
    coins: [
      [15, 18, g],
      [49, 18, k],
      [32, 44, r],
      [15, 70, k],
      [49, 70, g],
    ],
  },
  6: {
    radius: 10.8,
    coins: [
      [19, 18, r],
      [45, 18, r],
      [19, 50, g],
      [45, 50, g],
      [19, 72, g],
      [45, 72, g],
    ],
  },
  7: {
    radius: 9.2,
    coins: [
      [13, 13, r],
      [32, 21, r],
      [51, 29, r],
      [20, 55, g],
      [44, 55, g],
      [20, 75, g],
      [44, 75, g],
    ],
  },
  8: {
    radius: 10,
    coins: [
      [19, 13, k],
      [45, 13, k],
      [19, 34, k],
      [45, 34, k],
      [19, 55, k],
      [45, 55, k],
      [19, 76, k],
      [45, 76, k],
    ],
  },
  9: {
    radius: 9.5,
    coins: [
      [13, 16, g],
      [32, 16, g],
      [51, 16, g],
      [13, 44, r],
      [32, 44, r],
      [51, 44, r],
      [13, 72, k],
      [32, 72, k],
      [51, 72, k],
    ],
  },
};

// 2～7、9 条：[x, y, 长度, 颜色]。1 条为雀鸟，8 条由 EightTiao 绘制。
type Stick = [x: number, y: number, length: number, color: string];

const tiaoLayouts: Record<number, Stick[]> = {
  2: [
    [32, 24, 30, g],
    [32, 64, 30, g],
  ],
  3: [
    [32, 24, 30, g],
    [18, 64, 30, g],
    [46, 64, 30, g],
  ],
  4: [
    [19, 24, 30, g],
    [45, 24, 30, g],
    [19, 64, 30, g],
    [45, 64, 30, g],
  ],
  5: [
    [15, 24, 30, g],
    [49, 24, 30, g],
    [32, 44, 26, r],
    [15, 64, 30, g],
    [49, 64, 30, g],
  ],
  6: [
    [16, 25, 32, g],
    [32, 25, 32, g],
    [48, 25, 32, g],
    [16, 63, 32, g],
    [32, 63, 32, g],
    [48, 63, 32, g],
  ],
  7: [
    [32, 14, 18, r],
    [16, 41, 24, g],
    [32, 41, 24, g],
    [48, 41, 24, g],
    [16, 71, 24, g],
    [32, 71, 24, g],
    [48, 71, 24, g],
  ],
  9: [
    [16, 16, 23, g],
    [32, 16, 23, r],
    [48, 16, 23, g],
    [16, 44, 23, g],
    [32, 44, 23, r],
    [48, 44, 23, g],
    [16, 72, 23, g],
    [32, 72, 23, r],
    [48, 72, 23, g],
  ],
};

function Bird() {
  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M28 48C16 52 10 64 12 76C22 73 30 63 33 54" fill="#177b55" />
      <path
        d="M23 55L16 69M28 54L21 69M31 53L27 66"
        stroke="#77b17d"
        strokeWidth="2"
      />
      <path
        d="M35 24C51 29 54 45 43 56C38 61 27 61 23 55C16 44 21 36 30 32"
        fill="#188652"
        stroke="#0a603a"
        strokeWidth="1.5"
      />
      <path d="M31 37C38 30 46 36 43 44C40 51 30 55 27 48Z" fill="#42a772" />
      <path
        d="M28 40L39 39M27 44L38 43M28 48L35 47"
        stroke="#dbdeb0"
        strokeWidth="1.5"
      />
      <path
        d="M31 31C24 27 25 18 32 15C41 10 49 16 46 23L39 29L39 38"
        fill="#187642"
        stroke="#095b39"
        strokeWidth="1.5"
      />
      <path
        d="M32 15L29 10M35 14L35 8M39 14L41 9"
        stroke="#c92e35"
        strokeWidth="2.5"
      />
      <path d="M45 21L55 24L46 27Z" fill="#be2b35" />
      <circle cx="40" cy="20" r="2" fill="#fff8dc" />
      <circle cx="40.5" cy="20" r="1" fill="#152f35" />
      <path
        d="M35 60L34 72L27 76M41 58L43 70L49 73M34 72L39 76"
        fill="none"
        stroke="#be2b35"
        strokeWidth="2.4"
      />
    </g>
  );
}

function BambooStick({
  x,
  y,
  length,
  color,
}: {
  x: number;
  y: number;
  length: number;
  color: string;
}) {
  const half = length / 2;
  const width = length >= 28 ? 8 : 7;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        x={-width / 2}
        y={-half}
        width={width}
        height={length}
        rx={width / 2}
        fill={color}
      />
      {[-half + 1.6, 0, half - 1.6].map((nodeY) => (
        <ellipse
          key={nodeY}
          cx="0"
          cy={nodeY}
          rx={width / 2 + 1.2}
          ry="1.7"
          fill={color}
        />
      ))}
      <path
        d={`M0 ${-half + 3.6}V-2.4M0 2.4V${half - 3.6}`}
        stroke="#ffffff"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </g>
  );
}

const eightTiaoNodes: [number, number][] = [
  [12.5, 13.5],
  [12.5, 26],
  [12.5, 38.5],
  [22.25, 30.25],
  [32, 22],
  [41.75, 30.25],
  [51.5, 38.5],
  [51.5, 26],
  [51.5, 13.5],
];

function EightTiao() {
  const path = "M12.5 13.5V38.5L32 22L51.5 38.5V13.5";
  const half = (
    <>
      <path
        d={path}
        fill="none"
        stroke={GREEN}
        strokeWidth="6.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {eightTiaoNodes.map(([cx, cy], index) => (
        <circle key={index} cx={cx} cy={cy} r="4.1" fill={GREEN} />
      ))}
      <path
        d={path}
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
  return (
    <g>
      <g>{half}</g>
      <g transform="translate(0 88) scale(1 -1)">{half}</g>
    </g>
  );
}

function CoinMark({
  x,
  y,
  radius,
  color,
}: {
  x: number;
  y: number;
  radius: number;
  color: string;
}) {
  return (
    <g transform={`translate(${x} ${y})`} fill="none" stroke={color}>
      <circle r={radius - 1.3} strokeWidth="2.8" />
      <circle r={radius * 0.5} strokeWidth="1.9" />
      <circle r={radius * 0.17} fill={color} stroke="none" />
    </g>
  );
}

function OneTong() {
  return (
    <g transform="translate(32 44)">
      <circle r="23" fill="none" stroke={GREEN} strokeWidth="2.4" />
      {Array.from({ length: 18 }, (_, index) => {
        const angle = (index / 18) * Math.PI * 2;
        return (
          <circle
            key={index}
            cx={(18.4 * Math.cos(angle)).toFixed(2)}
            cy={(18.4 * Math.sin(angle)).toFixed(2)}
            r="1.7"
            fill={GREEN}
          />
        );
      })}
      <circle r="14" fill="none" stroke={GREEN} strokeWidth="1.6" />
      <circle r="10.5" fill={RED} />
      <circle r="6.5" fill="none" stroke="#ffffff" strokeWidth="1.2" />
      <path
        d="M-5 0H5M0 -5V5"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </g>
  );
}

export function MahjongFace({ tile }: { tile: Tile }) {
  const suit = suitOf(tile);
  const rank = (tile % 9) + 1;
  return (
    <svg
      className={`tileFace face-${suit}`}
      viewBox="0 0 64 88"
      aria-hidden="true"
    >
      {suit === "wan" && (
        <g
          fontFamily="KaiTi, STKaiti, SimSun, serif"
          fontWeight="700"
          textAnchor="middle"
        >
          <text
            x="32"
            y="37"
            fontSize="34"
            fill={BLACK}
            stroke={BLACK}
            strokeWidth="1.4"
          >
            {characters[rank - 1]}
          </text>
          <text
            x="32"
            y="78"
            fontSize="38"
            fill={RED}
            stroke={RED}
            strokeWidth="0.8"
          >
            萬
          </text>
        </g>
      )}
      {suit === "tong" &&
        (rank === 1 ? (
          <OneTong />
        ) : (
          tongLayouts[rank].coins.map(([x, y, color], index) => (
            <CoinMark
              key={index}
              x={x}
              y={y}
              radius={tongLayouts[rank].radius}
              color={color}
            />
          ))
        ))}
      {suit === "tiao" &&
        (rank === 1 ? (
          <Bird />
        ) : rank === 8 ? (
          <EightTiao />
        ) : (
          tiaoLayouts[rank].map(([x, y, length, color], index) => (
            <BambooStick
              key={index}
              x={x}
              y={y}
              length={length}
              color={color}
            />
          ))
        ))}
    </svg>
  );
}

export function TilePiece({
  tile,
  className = "",
  label,
}: {
  tile: Tile;
  className?: string;
  label?: string;
}) {
  const accessibleLabel = label ?? labelOf(tile);
  return (
    <span
      className={`mahjongTile ${className}`}
      role="img"
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      <MahjongFace tile={tile} />
    </span>
  );
}

export function TileBack() {
  return (
    <span className="tileBack" aria-hidden="true">
      <i />
    </span>
  );
}
