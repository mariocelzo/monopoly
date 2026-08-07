import { useEffect, useState } from 'react';

function Die({ value, size }: { value: number; size: number }) {
  return (
    <div
      style={{
        ...styles.die,
        width: size,
        height: size,
        borderRadius: size * 0.18,
        fontSize: size * 0.52,
      }}
    >
      {value}
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    color: 'var(--ink)',
    background: 'linear-gradient(150deg, #f7f1e3 0%, #ddd2ba 100%)',
    boxShadow: '0 2px 6px rgba(0,0,0,0.45), inset 0 -2px 3px rgba(0,0,0,0.15)',
  },
};
