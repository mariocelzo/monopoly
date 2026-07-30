import { useState } from 'react';
import type { BoardSquare } from '../socket';
import { rankedPlayers, mostLandedSquare } from '../scoreboard';
import { loadScoreboard, resetScoreboard } from '../scoreboardStorage';
import { formatDuration } from '../gameSummary';

/**
 * Tabellino fra una partita e l'altra: chi ha vinto quante volte, più
 * qualche record. Vive solo nel browser (vedi scoreboardStorage.ts): il
 * server su Render (piano gratuito) ha filesystem effimero, quindi un
 * archivio condiviso lì sopra non sopravviverebbe a un deploy. Funziona lo
 * stesso perché i due giocatori sono entrambi presenti a ogni fine partita:
 * ciascun dispositivo registra lo stesso risultato e i due conteggi restano
 * naturalmente d'accordo — il limite (si perde cancellando i dati del
 * browser) va detto, non nascosto, vedi la notina più sotto.
 *
 * Letto una volta al montaggio, non "in diretta": questo componente vive
 * dentro schermate che si rimontano già a ogni partita (il riquadro di fine
 * partita torna a comparire con state.finished, il pannello prima del via
 * con !state.started), quindi non serve altro per restare aggiornato.
 *
 * `compact` toglie record, notina e comando di azzeramento: usato nella
 * schermata d'attesa prima del via, dove serve solo un promemoria di chi è
 * avanti, non l'intero riepilogo (quello sta nella schermata di fine
 * partita, accanto al riepilogo statistico della partita appena giocata).
 */
export default function Scoreboard({
  board,
  compact = false,
}: {
  board: BoardSquare[];
  compact?: boolean;
}) {
  const [data, setData] = useState(() => loadScoreboard());
  const [confirmingReset, setConfirmingReset] = useState(false);

  const ranked = rankedPlayers(data);
  // Prima di qualunque risultato registrato non c'è niente da mostrare: uno
  // spazio vuoto con solo un titolo sarebbe peggio di niente.
  if (ranked.length === 0) return null;

  const gettonata = mostLandedSquare(data.landingsTotals);
  const gettonataSquare = gettonata ? board.find((s) => s.position === gettonata.position) : null;
  const haRecord = !compact && (data.records.longestGame || data.records.highestNetWorth || gettonataSquare);

  const reset = () => {
    setData(resetScoreboard());
    setConfirmingReset(false);
  };

  return (
    <div style={{ ...styles.wrap, ...(compact ? styles.wrapCompact : null) }}>
      <div style={styles.title}>Tabellino</div>
      <div style={styles.rows}>
        {ranked.map((p) => (
          <div key={p.key} style={styles.row}>
            <span style={styles.name}>{p.displayName}</span>
            <span className="mono" style={styles.tally}>
              {p.wins} {p.wins === 1 ? 'vittoria' : 'vittorie'} · {p.gamesPlayed}{' '}
              {p.gamesPlayed === 1 ? 'partita' : 'partite'}
            </span>
          </div>
        ))}
      </div>

      {haRecord && (
        <div style={styles.records}>
          {data.records.longestGame && (
            <div style={styles.recordLine}>
              ⏱ Partita più lunga: {formatDuration(data.records.longestGame.ms)} (
              {data.records.longestGame.playerNames.join(' vs ')})
            </div>
          )}
          {data.records.highestNetWorth && (
            <div style={styles.recordLine}>
              💰 Patrimonio record: €{data.records.highestNetWorth.amount} (
              {data.records.highestNetWorth.name})
            </div>
          )}
          {gettonataSquare && (
            <div style={styles.recordLine}>
              📍 Casella più gettonata di sempre: {gettonataSquare.name} ({gettonata!.count}×)
            </div>
          )}
        </div>
      )}

      {!compact && (
        <>
          <p style={styles.note}>Conservato solo su questo browser: si perde cancellando i dati del browser.</p>
          {!confirmingReset ? (
            <button style={styles.resetLink} onClick={() => setConfirmingReset(true)}>
              Azzera tabellino
            </button>
          ) : (
            <div style={styles.confirmRow}>
              <span style={styles.confirmText}>Azzerare tutto? Non si torna indietro.</span>
              <div style={styles.confirmButtons}>
                <button className="btn-ghost" style={styles.confirmBtn} onClick={reset}>
                  Azzera
                </button>
                <button
                  className="btn-ghost"
                  style={styles.confirmBtn}
                  onClick={() => setConfirmingReset(false)}
                >
                  Annulla
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    textAlign: 'left',
    marginTop: 14,
    paddingTop: 12,
    borderTop: '1px solid rgba(201,150,44,0.2)',
  },
  // Nella schermata d'attesa non c'è un riepilogo sopra da separare: niente
  // bordo, solo un piccolo distacco dal blocco giocatori.
  wrapCompact: { borderTop: 'none', paddingTop: 0, marginTop: 4, gap: 4 },
  title: { fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--brass-2)' },
  rows: { display: 'flex', flexDirection: 'column', gap: 4 },
  row: { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.82rem' },
  name: { color: 'var(--paper)', fontWeight: 600 },
  tally: { color: 'rgba(243,234,216,0.7)', fontSize: '0.76rem', whiteSpace: 'nowrap' },
  records: { display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 },
  recordLine: { fontSize: '0.74rem', color: 'rgba(243,234,216,0.6)' },
  note: { fontSize: '0.7rem', color: 'rgba(243,234,216,0.45)', fontStyle: 'italic', marginTop: 4, lineHeight: 1.4 },
  resetLink: {
    alignSelf: 'flex-start',
    background: 'none',
    border: 'none',
    color: 'rgba(243,234,216,0.4)',
    fontSize: '0.72rem',
    textDecoration: 'underline',
    cursor: 'pointer',
    padding: 0,
  },
  confirmRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: 8,
    borderRadius: 8,
    border: '1px solid rgba(179,58,58,0.4)',
    background: 'rgba(179,58,58,0.1)',
  },
  confirmText: { fontSize: '0.74rem', color: 'var(--paper)' },
  confirmButtons: { display: 'flex', gap: 6 },
  confirmBtn: { flex: 1, minHeight: 36, fontSize: '0.76rem' },
};
