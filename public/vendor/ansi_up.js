// Lightweight ANSI to HTML converter
(function (global) {
  const ANSI_COLORS = {
    0: 'inherit',
    1: 'bold',
    2: 'dim',
    30: '#1e293b', // black
    31: '#f87171', // red
    32: '#4ade80', // green
    33: '#facc15', // yellow
    34: '#60a5fa', // blue
    35: '#c084fc', // magenta
    36: '#38bdf8', // cyan
    37: '#f1f5f9', // white
    90: '#64748b', // bright black / gray
    91: '#ef4444', // bright red
    92: '#22c55e', // bright green
    93: '#eab308', // bright yellow
    94: '#3b82f6', // bright blue
    95: '#a855f7', // bright magenta
    96: '#06b6d4', // bright cyan
    97: '#ffffff', // bright white
  };

  class AnsiUp {
    constructor() {
      this.use_classes = false;
    }

    ansi_to_html(txt) {
      if (!txt) return '';
      // Escape HTML special chars
      let html = txt
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      let activeColor = null;
      let isBold = false;
      let isDim = false;

      // Regular expression to match ANSI escape sequences
      const ansiRegex = /\x1b\[([0-9;]*)m/g;

      html = html.replace(ansiRegex, (match, codeStr) => {
        if (!codeStr || codeStr === '0') {
          // Reset
          activeColor = null;
          isBold = false;
          isDim = false;
          return '</span>';
        }

        const codes = codeStr.split(';').map(c => parseInt(c, 10));
        for (const code of codes) {
          if (code === 0) {
            activeColor = null;
            isBold = false;
            isDim = false;
          } else if (code === 1) {
            isBold = true;
          } else if (code === 2) {
            isDim = true;
          } else if (code === 22) {
            isBold = false;
            isDim = false;
          } else if (code === 39) {
            activeColor = null;
          } else if (ANSI_COLORS[code]) {
            activeColor = ANSI_COLORS[code];
          }
        }

        const styles = [];
        if (activeColor) styles.push(`color: ${activeColor}`);
        if (isBold) styles.push('font-weight: 700');
        if (isDim) styles.push('opacity: 0.65');

        return `</span><span style="${styles.join('; ')}">`;
      });

      return html.replace(/\r\n/g, '<br>').replace(/\n/g, '<br>');
    }
  }

  global.AnsiUp = AnsiUp;
})(typeof window !== 'undefined' ? window : this);
