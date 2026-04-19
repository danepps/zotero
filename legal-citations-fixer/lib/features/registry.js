"use strict";

// Ordered list of rewriting features. Each feature is invoked by patch.js
// with a ctx object; its return value (if a string) becomes the new text
// for the next feature in the chain.
//
// To enable a new feature:
//   1. Create lib/features/<your-feature>.js that sets
//        LCF.features.<id> = { id, rewrite(ctx) };
//   2. Load it from bootstrap.js (loadSubScript).
//   3. Add it to the list below, in the order it should run.

LCF.features.list = [
    LCF.features.hereinafter
];
