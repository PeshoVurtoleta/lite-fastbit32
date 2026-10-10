/**
 * SC-1 experiment -- guarded `clz32 ^ 31` scans vs branchless `31 - clz32`.
 *
 *     node benchmark/experiments/sc1-scans.mjs
 *
 * ROADMAP SC-1 asks whether removing the four `=== 0` guards (option B, the
 * branchless RESEARCH-7 bodies) is measurably faster than the current guarded
 * forms (option A). This is MEASUREMENT ONLY: both variants are SCRATCH copies
 * here -- FastBit32.js is NOT touched (S3 applies the decision). The numbers
 * below are the input to S3's SC-1 vote.
 *
 * The bodies are byte-for-byte RESEARCH section 7. A self-check first asserts the
 * two variants agree on every word in a corpus that includes 0 and -1 (the only
 * words where `^ 31` and `31 -` disagree): 0 mismatches is the precondition for
 * comparing their speed at all.
 *
 * Harness: the RESEARCH section 2 rule -- each scan is a LITERAL expression
 * inlined into its own compiled loop (no fn passed to a shared site, which would
 * not inline), result XORed into an Int32Array sink. PASSES passes per cell; in
 * each pass the floor, guarded and branchless loops are timed best-of-REPS with
 * their reps interleaved, and the reported ns/op is the MEDIAN pass. The gap's
 * NOISE is the range of the per-pass gaps: a |gap| inside it prints `sub-noise`.
 * Three corpora (empty-heavy 90% zero, full-heavy 90% -1, random) x two lanes
 * (HOT, PRESSURE: a 32 MB stream at a 4099-word stride in both the op and floor
 * loops; the stream index is masked every step so it stays int32 -- an unmasked
 * `si += 4099` leaves int32 after ~524k steps and deopts the loop -- and persists
 * across calls). Timing only.
 */

const SINK = new Int32Array(1);
const STREAM_WORDS = 8 * 1024 * 1024; // 32 MB
const SMASK = STREAM_WORDS - 1;
const SI = new Int32Array(1); // persistent stream index

function makeRng(seed) {
  let s = seed | 0 || 0x9e3779b9;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; };
}

// --- the scans, both variants (SCRATCH, RESEARCH section 7) ------------------
const GUARDED = {
  lowest: 'if(w===0){r=-1;}else{r=Math.clz32(w & -w) ^ 31;}',
  highest: 'if(w===0){r=-1;}else{r=31 - Math.clz32(w);}',
  nextClearBit: 'var inv=~w>>>0; if(inv===0){r=-1;}else{r=Math.clz32(inv & -inv) ^ 31;}',
  highestClearBit: 'var inv2=~w>>>0; if(inv2===0){r=-1;}else{r=31 - Math.clz32(inv2);}',
};
const BRANCHLESS = {
  lowest: 'r=31 - Math.clz32(w & -w);',
  highest: 'r=31 - Math.clz32(w);',
  nextClearBit: 'r=31 - Math.clz32(~w & (w + 1));',
  highestClearBit: 'r=31 - Math.clz32(~w);',
};
const SCANS = ['lowest', 'highest', 'nextClearBit', 'highestClearBit'];

// reference (readable) implementations, for the self-check
const REF = {
  lowest: (w) => (w === 0 ? -1 : Math.clz32(w & -w) ^ 31),
  highest: (w) => (w === 0 ? -1 : 31 - Math.clz32(w)),
  nextClearBit: (w) => { const inv = ~w >>> 0; return inv === 0 ? -1 : Math.clz32(inv & -inv) ^ 31; },
  highestClearBit: (w) => { const inv = ~w >>> 0; return inv === 0 ? -1 : 31 - Math.clz32(inv); },
};
const REFB = {
  lowest: (w) => 31 - Math.clz32(w & -w),
  highest: (w) => 31 - Math.clz32(w),
  nextClearBit: (w) => 31 - Math.clz32(~w & (w + 1)),
  highestClearBit: (w) => 31 - Math.clz32(~w),
};

function makeLoop(stmt, pressure) {
  const stream = pressure ? 'acc=(acc+STREAM[si])|0; si=(si+4099)&SMASK;' : '';
  // eslint-disable-next-line no-new-func
  return new Function('corpus', 'outer', 'SINK', 'STREAM', 'SMASK', 'SI',
    'let si=SI[0], acc=0;\n' +
    'for(let o=0;o<outer;o++){\n' +
    '  for(let i=0;i<corpus.length;i++){\n' +
    '    const w=corpus[i];\n' +
    '    let r;\n' +
    '    ' + stmt + '\n' +
    '    acc^=r|0;\n' +
    '    ' + stream + '\n' +
    '  }\n' +
    '}\n' +
    'SINK[0]=acc; SI[0]=si;\n');
}

// one pass: floor, guarded, branchless reps interleaved; minima into BEST[0..2].
const BEST = new Float64Array(3);
function bestTriple(fF, fG, fB, reps) {
  let mf = Infinity, mg = Infinity, mb = Infinity;
  for (let r = 0; r < reps; r++) {
    const t0 = performance.now(); fF();
    const t1 = performance.now(); fG();
    const t2 = performance.now(); fB();
    const t3 = performance.now();
    if (t1 - t0 < mf) mf = t1 - t0;
    if (t2 - t1 < mg) mg = t2 - t1;
    if (t3 - t2 < mb) mb = t3 - t2;
  }
  BEST[0] = mf; BEST[1] = mg; BEST[2] = mb;
}
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };

function buildCorpus(kind, rng, n) {
  const a = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const rand = rng() | 0;
    if (kind === 'empty-heavy') a[i] = (rng() % 10 === 0) ? rand : 0;
    else if (kind === 'full-heavy') a[i] = (rng() % 10 === 0) ? rand : -1;
    else a[i] = rand;
  }
  return a;
}

function selfCheck() {
  const rng = makeRng(0xc0ffee);
  const words = [0, -1, 1, 1 << 31, 0x7fffffff, -2147483648];
  for (let i = 0; i < 5000; i++) words.push(rng() | 0);
  for (const scan of SCANS) {
    for (const w of words) {
      const g = REF[scan](w), b = REFB[scan](w);
      if (g !== b) throw new Error(`SC-1 self-check: ${scan}(${w}) guarded=${g} branchless=${b}`);
    }
  }
  console.log('self-check: guarded === branchless on ' + words.length + ' words incl 0, -1, 2^31 -- 0 mismatches');
}

function run() {
  selfCheck();
  const rng = makeRng(0x5eed1234);
  const N = 2048, REPS = 5, PASSES = 3;
  const OUTER = { HOT: 1024, PRESSURE: 256 };
  const corpora = ['empty-heavy', 'full-heavy', 'random'];
  const lanes = ['HOT', 'PRESSURE'];
  const STREAMS = { HOT: new Int32Array(1), PRESSURE: new Int32Array(STREAM_WORDS) };
  for (let i = 0; i < STREAM_WORDS; i++) STREAMS.PRESSURE[i] = Math.imul(i, 0x9e3779b1);

  console.log('\nns/op (floor-subtracted, median of ' + PASSES + ' passes, each best of ' + REPS + ' interleaved), node ' +
    process.version + ', ops/cell HOT=' + N * OUTER.HOT + ' PRESSURE=' + N * OUTER.PRESSURE);
  console.log('scan             corpus        lane      guarded  branchless      gap  noise  verdict');
  const rows = [];
  for (const scan of SCANS) {
    for (const kind of corpora) {
      const corpus = buildCorpus(kind, rng, N);
      for (const lane of lanes) {
        const pressure = lane === 'PRESSURE';
        const STREAM = STREAMS[lane];
        const outer = OUTER[lane], total = N * outer;
        const floor = makeLoop('r=w;', pressure);
        const g = makeLoop(GUARDED[scan], pressure);
        const b = makeLoop(BRANCHLESS[scan], pressure);
        const call = (L) => L(corpus, outer, SINK, STREAM, SMASK, SI);
        call(floor); call(g); call(b); // warm
        const gs = [], bs = [], gaps = [];
        for (let p = 0; p < PASSES; p++) {
          bestTriple(() => call(floor), () => call(g), () => call(b), REPS);
          const f = BEST[0] * 1e6 / total;
          const gn = BEST[1] * 1e6 / total - f, bn = BEST[2] * 1e6 / total - f;
          gs.push(gn); bs.push(bn); gaps.push(gn - bn);
        }
        const gn = med(gs), bn = med(bs), gap = med(gaps);
        const noise = Math.max(...gaps) - Math.min(...gaps);
        const verdict = !(Math.abs(gap) > noise) ? 'sub-noise' : (gap > 0 ? 'branchless faster' : 'guarded faster');
        rows.push({ scan, kind, lane, guarded: gn, branchless: bn, gap, noise, verdict });
        console.log(
          scan.padEnd(16) + ' ' + kind.padEnd(13) + ' ' + lane.padEnd(9) + ' ' +
          gn.toFixed(3).padStart(7) + '  ' + bn.toFixed(3).padStart(10) + '  ' +
          (gap >= 0 ? '+' : '') + gap.toFixed(3).padStart(6) + '  ' + noise.toFixed(3) + '  ' + verdict);
      }
    }
  }
  // headline: the highestClearBit empty/full-heavy gap is the >>> 0 HeapNumber tax.
  const hcbEmpty = rows.find((x) => x.scan === 'highestClearBit' && x.kind === 'empty-heavy' && x.lane === 'HOT');
  console.log('\nHEADLINE: highestClearBit empty-heavy HOT -- guarded ' + hcbEmpty.guarded.toFixed(2) +
    ' ns vs branchless ' + hcbEmpty.branchless.toFixed(2) + ' ns (the ~v>>>0 HeapNumber slow path, FB-09).');
  const sub = rows.filter((x) => x.scan !== 'highestClearBit' && x.verdict === 'sub-noise').length;
  const other = rows.filter((x) => x.scan !== 'highestClearBit').length;
  console.log('lowest/highest/nextClearBit: ' + sub + '/' + other + ' cells sub-noise; the rest print their gap and noise above.');
}

run();
