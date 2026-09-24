/**
 * Where a slow request actually spent its time.
 *
 * Phases are reported in the `Server-Timing` header, which every browser's
 * network panel already knows how to draw - so "the API is slow" stops being a
 * guess about the network, the database or the bucket and becomes a number per
 * phase, measured on the machine that felt it.
 *
 * Deliberately cheap: a timestamp per phase and one header on the way out.
 */
export function timings(res) {
  const started = process.hrtime.bigint();
  let last = started;
  const phases = [];

  const since = (from) => Number(process.hrtime.bigint() - from) / 1e6;

  return {
    /** Closes the phase that just finished and names it. */
    step(name) {
      phases.push([name, since(last)]);
      last = process.hrtime.bigint();
    },

    /** Writes the header. Safe to call once, before anything is sent. */
    send() {
      if (res.headersSent) return;

      const total = since(started);
      const parts = phases
        .map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`)
        .concat(`total;dur=${total.toFixed(1)}`);

      res.set('Server-Timing', parts.join(', '));
    },
  };
}
