import { useState } from 'react';
import { buildInviteUrl } from '../invite';

/**
 * Copia il link diretto al tavolo. Chi lo riceve e lo apre si ritrova già
 * pronto a entrare, senza dover leggere o ricopiare il codice a mano.
 */
export default function InviteLink({
  roomCode,
  compact = false,
}: {
  roomCode: string;
  compact?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const url = buildInviteUrl(roomCode);

  const copy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        // Contesti non sicuri (http semplice) o browser vecchi: l'API moderna
        // non è disponibile, si passa dalla vecchia textarea nascosta.
        legacyCopy(url);
      }
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      // Permesso negato o clipboard bloccata: si mostra il link da selezionare
      // a mano invece di fallire in silenzio.
      setState('manual');
    }
  };

  if (state === 'manual') {
    return (
      <div style={styles.manualBox}>
        <p style={styles.manualHint}>Copialo a mano:</p>
        <input
          style={styles.manualInput}
          value={url}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
    );
  }

  return (
    <button
      className="btn-ghost"
      style={{ ...styles.button, ...(compact ? styles.compact : null) }}
      onClick={copy}
    >
      {state === 'copied' ? '✓ Link copiato' : '🔗 Copia link invito'}
    </button>
  );
}

/** Copia legacy via textarea nascosta, per contesti senza Clipboard API. */
function legacyCopy(text: string) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  ta.style.pointerEvents = 'none';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

const styles: Record<string, React.CSSProperties> = {
  button: { width: '100%', fontSize: '0.82rem', padding: '8px 14px' },
  compact: { minHeight: 42, fontSize: '0.88rem' },
  manualBox: { display: 'flex', flexDirection: 'column', gap: 5 },
  manualHint: { fontSize: '0.72rem', color: 'rgba(27,36,48,0.55)', margin: 0 },
  manualInput: {
    padding: '8px 10px',
    borderRadius: 7,
    border: '1px solid rgba(27,36,48,0.15)',
    background: 'rgba(27,36,48,0.05)',
    color: 'var(--ink)',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.72rem',
  },
};
