// test/torture/t4-mapper.mjs -- BitMapper abuse, each case pinned to a decided
// policy (throw / documented value). Values verified against HEAD. The
// mapper-dedup control breaks the duplicate-name pin (teeth).

export function run(ctx) {
    const Mapper = ctx.Mapper;
    const fails = [];
    let green = 0;
    const F = (m) => fails.push('T4: ' + m);
    const throws = (fn) => { try { fn(); return false; } catch { return true; } };

    // --- policy: throw --------------------------------------------------------
    if (!throws(() => new Mapper(Array.from({ length: 33 }, (_, i) => 'F' + i)))) F('33 names must throw');
    if (!throws(() => new Mapper(['A']).get('?'))) F('unknown get must throw');
    if (!throws(() => new Mapper(['A', 'B']).getMask(['A', '?', 'B']))) F('getMask unknown mid-list must throw');
    if (!throws(() => new Mapper(null))) F('ctor(null) must throw');
    if (!throws(() => new Mapper('abc'))) F("ctor('abc') must throw");

    // --- policy: documented value --------------------------------------------
    if (new Mapper(['A', 'A', 'B']).get('A') !== 1) F('dup last-wins get(A)=1');
    if (new Mapper([1, null, {}]).get(null) !== 1) F('[1,null,{}] get(null)=1');
    {
        const m = new Mapper(['__proto__', 'constructor', 'toString']);
        if (m.get('__proto__') !== 0 || m.get('constructor') !== 1 || m.get('toString') !== 2) F('proto-shaped names by index');
    }
    {
        const m = new Mapper(['A']);
        for (const bad of [-1, 32, 1.5, NaN]) if (m.getName(bad) !== undefined) F('getName(' + String(bad) + ') must be undefined');
    }
    if (new Mapper(['A']).getMask([]) !== 0) F('getMask([]) = 0');
    {
        const names = Array.from({ length: 32 }, (_, i) => 'C' + i);
        if (new Mapper(names).getMask(['C31']) !== 2147483648) F('bit-31-name mask = 2147483648');
    }

    void green;
    return { fails, green };
}
