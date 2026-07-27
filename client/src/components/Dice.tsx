import { useEffect, useState } from 'react';

// Posizione dei pallini per ogni faccia, su una griglia 3x3 (indici 0-8).
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Die({ value, size }: { value: number; size: number }) {
  const pips = PIPS[value] || [];
  return (
    <div style={{ ...styles.die, width: size, height: size, borderRadius: size * 0.18 }}>
      {Array.from({ length: 9 }).map((_, i) => (
        <span
          key={i}
          style={{
            ...styles.pip,
            width: size * 0.16,
            height: size * 0.16,
            visibility: pips.includes(i) ? 'visible' : 'hidden',
          }}
        />
      ))}
    </div>
  );
}

/**
 * I due dadi dell'ultimo tiro. A ogni nuovo lancio (riconosciuto da `seq`)
 * ruzzolano per mezzo secondo mostrando facce a caso, poi si fermano sul
 * risultato vero arrivato dal server.
 */
export default function Dice({
  dice,
  seq,
  size = 34,
}: {
  dice: [number, number];
  seq: number;
  size?: number;
}) {
  const [rolling, setRolling] = useState(false);
  const [shown, setShown] = useState<[number, number]>(dice);

  useEffect(() => {
    setRolling(true);
    const shuffle = window.setInterval(() => {
      setShown([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
    }, 70);
    const stop = window.setTimeout(() => {
      window.clearInterval(shuffle);
      setShown(dice);
      setRolling(false);
    }, 500);
    return () => {
      window.clearInterval(shuffle);
      window.clearTimeout(stop);
    };
    // Il tiro è identificato da seq: due 3-3 di fila restano due tiri distinti.
  }, [seq]);

  // Se lo stato arriva senza un tiro nuovo (per esempio dopo un acquisto) i
  // dadi devono comunque mostrare il valore corretto.
  useEffect(() => {
    if (!rolling) setShown(dice);
  }, [dice[0], dice[1], rolling]);

  return (
    <div style={{ ...styles.pair, gap: size * 0.25 }} className={rolling ? 'dice-rolling' : undefined}>
      <Die value={shown[0]} size={size} />
      <Die value={shown[1]} size={size} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pair: { display: 'flex', alignItems: 'center' },
  die: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gridTemplateRows: 'repeat(3, 1fr)',
    padding: '11%',
    background: 'linear-gradient(150deg, #f7f1e3 0%, #ddd2ba 100%)',
    boxShadow: '0 2px 6px rgba(0,0,0,0.45), inset 0 -2px 3px rgba(0,0,0,0.15)',
  },
  pip: { borderRadius: '50%', background: '#1b2430', placeSelf: 'center' },
};
