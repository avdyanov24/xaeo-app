/* Xo morph renderer, player and stage director (assets/xo-morph-v1). Loaded by XoFrames.dc.html.
   - Renderer: traced, layered vector shapes of Xo, morphed between generated keyframes, in the landing's
     canonical 400 x 420 space (feet contact at y = 400).
   - Player: one per Xo. One waiting request (newest wins). Interruptions finish the current phrase when less
     than 600ms is left, otherwise settle to the rest pose (240ms ease-out), hold 150ms, then start.
     Cheer and the hero greeting always play to the end.
   - Director: one shared animation loop for every Xo, lazy clip loading, and one animated Xo per screen.
   The block between EMBED markers (manifest + rest pose) is written by tools/xo-morph/morph.py.
   Data format and pipeline: README.md in this folder. */
(function () {
  if (window.XoMorph) return;
  const EMB = /*EMBED*/ {
    q: 4,
    layers: [
      'gills',
      'body',
      'tail',
      'lines',
      'feet',
      'belly',
      'eyes',
      'hl',
      'lids',
      'mouth',
      'tongue',
    ],
    col: {
      tail: '#0834d1',
      lines: '#062fc0',
      feet: '#0124a9',
      gills: '#fa372e',
      body: '#033efa',
      belly: '#ccd5fb',
      eyes: '#0b1039',
      hl: '#f7f8f9',
      lids: '#0628c8',
      mouth: '#0b1039',
      tongue: '#f2545b',
    },
    rest: [
      [
        [
          341, 808, -9, 4, -10, 3, -11, 1, -13, 1, -12, 1, -13, 1, -13, 1, -13, 1, -14, 1, -13, 0,
          -13, -1, -12, -1, -13, -3, -12, -4, -11, -6, -10, -7, -8, -9, -7, -10, -5, -11, -2, -12,
          -1, -13, 2, -12, 3, -12, 5, -11, 7, -10, 9, -9, 10, -7, 11, -6, 12, -5, 12, -3, 13, -2,
          13, -1, 13, 0, 13, 1, 13, 0, 12, 0, 11, 0, 8, -2, 4, -3, 0, -4, -4, -4, -8, -4, -10, -4,
          -12, -4, -13, -4, -12, -4, -13, -4, -12, -5, -12, -5, -12, -5, -11, -6, -11, -8, -10, -8,
          -9, -9, -7, -10, -5, -11, -3, -12, -1, -12, 1, -13, 3, -12, 4, -11, 7, -10, 8, -9, 10, -8,
          11, -5, 12, -4, 12, -2, 13, 0, 13, 1, 12, 2, 13, 4, 12, 4, 12, 5, 13, 5, 12, 5, 12, 6, 12,
          5, 12, 5, 12, 6, 11, 5, 11, 4, 10, 2, 8, 0, 5, -3, 1, -5, -3, -6, -7, -8, -8, -7, -10, -8,
          -11, -8, -10, -8, -11, -7, -11, -8, -10, -8, -10, -8, -10, -9, -10, -9, -8, -10, -7, -10,
          -5, -11, -3, -12, -2, -13, 0, -12, 2, -12, 4, -12, 6, -11, 7, -10, 9, -9, 11, -7, 11, -6,
          11, -3, 13, -2, 12, 0, 12, 1, 13, 4, 11, 5, 12, 6, 10, 8, 11, 8, 10, 8, 10, 8, 10, 9, 9,
          9, 10, 10, 9, 9, 9, 10, 9, 9, 9, 9, 9, 9, 8, 8, 7, 9, 4, 9, 0, 9, -3, 10, -6, 9, -7, 9,
          -9, 10, -9, 9, -10, 9, -9, 9, -10, 9, -9, 10, -9, 9, -9, 10, -7, 10, -7, 10, -7, 11, -6,
          12, -5, 12, -6, 12, -6, 11, -5, 12, -6, 12, -6, 12, -5, 12, -5, 11, -4, 13, -2, 12, -2,
          13, -1, 13, 0, 13, 0, 13, -1, 13, -1, 12, -3, 11, -4, 9,
        ],
        [
          1418, 953, -12, 2, -13, 2, -13, -1, -12, -2, -13, -2, -13, -4, -12, -4, -13, -4, -12, -4,
          -13, -4, -11, -5, -11, -5, -9, -6, -6, -9, -4, -9, -1, -11, 1, -12, 3, -13, 3, -12, 4,
          -13, 4, -12, 4, -13, 4, -12, 3, -13, 2, -12, 1, -13, 0, -13, 0, -13, -2, -13, -1, -13, -2,
          -13, -2, -13, -2, -13, -2, -13, -3, -12, -5, -12, -6, -11, -6, -11, -7, -11, -7, -11, -8,
          -11, -7, -11, -7, -11, -7, -11, -6, -11, -6, -11, -4, -11, -1, -10, 2, -9, 5, -8, 7, -7,
          10, -7, 10, -7, 10, -7, 11, -8, 10, -8, 11, -8, 10, -8, 11, -8, 10, -8, 11, -7, 12, -7,
          11, -6, 12, -4, 12, -4, 13, -2, 13, 0, 12, 1, 12, 4, 11, 5, 11, 7, 9, 9, 7, 10, 6, 10, 4,
          12, 2, 12, -1, 13, -2, 12, -4, 12, -5, 11, -7, 11, -9, 9, -9, 9, -10, 9, -11, 7, -11, 7,
          -11, 7, -12, 7, -11, 7, -11, 7, -11, 7, -11, 7, -9, 7, -7, 8, -4, 7, -1, 6, 4, 4, 8, 2,
          10, 0, 11, -2, 12, -2, 13, -4, 13, -3, 12, -4, 13, -2, 13, -3, 13, -1, 13, -1, 12, 2, 12,
          3, 12, 5, 10, 6, 10, 8, 8, 10, 6, 11, 5, 11, 2, 12, 1, 13, -2, 12, -4, 12, -6, 11, -7, 10,
          -9, 8, -10, 8, -11, 6, -12, 5, -12, 4, -13, 3, -13, 2, -13, 2, -13, 1, -13, 2, -13, 1,
          -11, 1, -10, 2, -7, 3, -2, 3, 2, 4, 6, 4, 9, 3, 12, 3, 12, 2, 13, 3, 13, 3, 12, 4, 12, 4,
          11, 6, 11, 8, 9, 8, 7, 10, 6, 11, 4, 11, 2, 12, 0, 13, -2, 12, -4, 12, -6, 10, -7, 10,
          -10, 8, -10, 6,
        ],
      ],
      [
        [
          1094, 1600, -17, 2, -17, 2, -17, 0, -17, 1, -17, -1, -18, -1, -17, -1, -17, -2, -17, -3,
          -16, -4, -16, -6, -14, -7, -13, -9, -11, -11, -10, -11, -10, -12, -10, -10, -11, -8, -14,
          -6, -14, -3, -15, 0, -15, 2, -13, 6, -12, 8, -10, 11, -11, 11, -11, 12, -12, 10, -13, 9,
          -15, 7, -16, 6, -16, 4, -17, 3, -17, 2, -17, 2, -18, 1, -17, 0, -17, 0, -17, -1, -17, -3,
          -16, -3, -15, -6, -14, -7, -10, -10, -8, -12, -3, -13, 0, -14, 5, -14, 7, -14, 9, -13, 8,
          -14, 7, -14, 5, -14, 2, -16, -1, -15, -2, -16, -3, -16, -4, -15, -5, -12, -7, -10, -10,
          -6, -12, -3, -14, -2, -15, -2, -15, -4, -14, -7, -13, -9, -11, -11, -9, -13, -6, -15, -4,
          -16, -2, -16, 1, -17, 2, -16, 4, -17, 5, -16, 7, -16, 8, -15, 9, -14, 9, -15, 10, -13, 11,
          -14, 12, -12, 11, -13, 12, -12, 11, -12, 8, -11, 5, -12, 0, -12, -4, -12, -8, -11, -10,
          -12, -12, -11, -11, -13, -12, -13, -10, -13, -10, -14, -9, -14, -9, -15, -7, -16, -6, -16,
          -6, -15, -5, -16, -3, -17, -2, -16, -1, -17, 0, -17, 0, -16, 0, -17, 1, -17, 2, -16, 3,
          -16, 6, -16, 6, -15, 7, -15, 8, -15, 7, -16, 8, -15, 9, -15, 8, -15, 10, -14, 10, -14, 11,
          -13, 12, -12, 12, -13, 12, -12, 13, -12, 13, -11, 13, -11, 13, -10, 14, -10, 15, -9, 15,
          -8, 15, -9, 15, -8, 15, -7, 16, -7, 16, -7, 16, -6, 17, -5, 16, -5, 17, -5, 16, -4, 17,
          -3, 17, -3, 17, -2, 17, -1, 18, -1, 17, -1, 17, 0, 17, 1, 17, 2, 17, 2, 17, 2, 17, 4, 17,
          3, 17, 5, 16, 5, 16, 5, 17, 6, 16, 7, 15, 7, 16, 7, 15, 9, 15, 8, 14, 9, 14, 10, 14, 11,
          13, 11, 13, 11, 13, 11, 13, 12, 11, 12, 12, 13, 11, 14, 10, 13, 9, 15, 10, 14, 9, 15, 8,
          14, 8, 16, 7, 15, 6, 16, 5, 16, 4, 17, 3, 16, 3, 17, 2, 17, 2, 17, 2, 17, 0, 16, -1, 17,
          -3, 16, -4, 17, -4, 16, -6, 16, -6, 16, -6, 16, -6, 15, -8, 15, -9, 14, -10, 13, -12, 12,
          -11, 12, -13, 12, -13, 12, -13, 11, -13, 10, -12, 11, -11, 11, -7, 11, -4, 12, 1, 13, 4,
          14, 6, 14, 8, 15, 9, 14, 8, 16, 7, 15, 7, 16, 6, 16, 5, 16, 6, 16, 5, 15, 7, 12, 9, 10,
          10, 5, 13, 2, 14, -3, 15, -5, 15, -6, 16, -7, 16, -6, 16, -7, 16, -5, 16, -5, 17, -4, 16,
          -3, 17, -1, 16, 0, 16, 4, 14, 6, 12, 9, 10, 11, 8, 14, 4, 14, 1, 16, -2, 16, -4, 16, -5,
          16, -7, 16, -8, 15, -8, 15, -10, 14, -10, 14, -11, 13, -12, 13, -12, 12, -13, 11, -13, 11,
          -14, 10, -15, 9, -15, 8, -15, 7, -16, 6, -16, 6, -17, 4, -16, 3, -17, 2, -16, 1, -16, 2,
          -13, 4, -12, 6, -9, 8, -8, 11, -8, 12, -9, 11, -12, 10, -13, 8, -15, 6,
        ],
      ],
      [
        [
          1267, 1516, -15, 2, -15, 1, -15, 0, -16, -1, -14, -3, -14, -5, -12, -8, -13, -8, -13, -8,
          -12, -8, -8, -12, -2, -13, 1, -15, 4, -14, 4, -14, 9, -10, 12, -7, 14, -7, 14, -5, 14, -3,
          15, 0, 16, 2, 15, 1, 15, 0, 15, 0, 15, -2, 15, -3, 15, -1, 14, 3, 9, 8, 5, 13, -1, 14, -5,
          14, -7, 14, -7, 14, -5, 13, -5, 14, -5, 13, -9, 11, -13, 6,
        ],
      ],
      [
        [
          [
            555, 1041, -6, 13, -6, 15, -6, 17, -4, 11, -4, 11, -4, 12, -3, 11, -2, 12, -3, 11, -3,
            12, -3, 11, -3, 12, -3, 11, -3, 12, -4, 11, -3, 11, -3, 12, -3, 11, -4, 11, -4, 11, -5,
            17, -5, 17, -5, 13,
          ],
          57,
        ],
        [
          [
            1026, 1062, -3, 16, -4, 19, -4, 20, -3, 14, -2, 15, -1, 15, 0, 15, 0, 16, 0, 15, 1, 15,
            2, 15, 2, 14, 3, 15, 3, 14, 4, 14, 4, 13, 5, 14, 6, 13, 7, 12, 9, 12, 14, 15, 14, 13,
            11, 12,
          ],
          57,
        ],
        [
          [
            1213, 1273, -3, 7, -3, 8, -3, 8, -2, 2, 0, 3, -1, 3, 0, 3, -2, 3, -1, 2, -1, 3, -1, 3,
            0, 3, -1, 2, -1, 3, -2, 2, -1, 3, -1, 3, -1, 2, -2, 3, -1, 2, -4, 8, -5, 7, -4, 7,
          ],
          51,
        ],
      ],
      [
        [
          1095, 1603, -15, 1, -16, 1, -15, 0, -15, 0, -15, 0, -16, 0, -15, 0, -15, -2, -15, -2, -15,
          -2, -15, -2, -15, -4, -14, -5, -14, -6, -12, -9, -10, -11, -5, -13, 0, -13, 7, -13, 11,
          -10, 13, -6, 14, -3, 15, -2, 15, -3, 15, -2, 15, -3, 15, -4, 15, -4, 14, -4, 15, -6, 13,
          -6, 14, -7, 13, -8, 11, -10, 11, -11, 8, -12, 6, -13, 4, -14, 8, -10, 12, -8, 14, -5, 14,
          -5, 13, -2, 9, 3, -1, 8, -9, 9, -12, 7, -13, 7, -9, 10, -5, 13, -3, 15, -2, 14, 1, 14, 8,
          11, 11, 9, 13, 8, 10, 9, 5, 12, 1, 15, 1, 15, -2, 14, -6, 14, -10, 10, -12, 9, -14, 6,
          -14, 3,
        ],
        [
          607, 1603, -15, 1, -15, 1, -16, 0, -15, 0, -16, 0, -15, -1, -15, -1, -15, -3, -15, -4,
          -14, -6, -12, -9, -10, -11, -5, -13, 0, -15, 4, -14, 7, -13, 10, -12, 11, -11, 11, -10,
          11, -11, 12, -9, 12, -7, 14, 0, 14, 4, 14, 6, 15, 5, 14, 5, 15, 5, 15, 4, 15, 4, 15, 3,
          15, 3, 15, 2, 15, 3, 15, 3, 15, 4, 12, 6, 7, 11, 1, 14, -5, 13, -9, 12, -11, 11, -12, 8,
          -14, 7, -15, 4, -14, 4, -16, 3, -15, 2,
        ],
      ],
      [
        [
          846, 1496, -16, 5, -17, 3, -17, 0, -18, -1, -18, -3, -17, -4, -18, -4, -17, -6, -16, -7,
          -16, -8, -15, -10, -15, -11, -13, -12, -12, -13, -11, -15, -10, -15, -9, -16, -7, -16, -5,
          -18, -4, -17, -2, -18, -1, -18, 0, -18, 2, -18, 3, -18, 4, -18, 6, -17, 7, -17, 8, -17, 8,
          -15, 10, -16, 11, -14, 12, -14, 13, -13, 14, -11, 15, -11, 15, -9, 17, -7, 17, -6, 17, -4,
          18, -3, 18, 0, 17, 1, 18, 4, 17, 5, 16, 7, 16, 9, 14, 10, 14, 12, 12, 13, 12, 15, 10, 15,
          8, 15, 8, 17, 7, 17, 5, 17, 5, 18, 3, 18, 2, 18, 1, 18, 1, 18, -2, 18, -2, 18, -4, 18, -5,
          17, -7, 17, -7, 16, -10, 16, -10, 15, -12, 14, -12, 13, -13, 12, -14, 12, -14, 9,
        ],
      ],
      [
        [
          551, 853, -11, 1, -11, -1, -10, -2, -11, -3, -10, -4, -10, -5, -9, -6, -8, -7, -7, -8, -7,
          -9, -6, -9, -5, -10, -5, -10, -3, -10, -2, -11, -2, -11, -1, -11, 0, -12, 0, -11, 0, -11,
          2, -11, 2, -11, 2, -11, 4, -10, 4, -11, 4, -10, 5, -10, 5, -10, 6, -10, 7, -9, 7, -8, 8,
          -8, 8, -6, 10, -6, 9, -5, 11, -4, 10, -4, 11, -2, 11, 0, 11, 0, 11, 2, 10, 2, 10, 4, 10,
          5, 9, 7, 8, 7, 7, 8, 7, 9, 5, 9, 5, 10, 4, 11, 3, 10, 3, 11, 2, 11, 1, 11, 0, 11, 0, 12,
          0, 11, -1, 11, -2, 11, -2, 11, -4, 10, -3, 11, -4, 10, -5, 11, -5, 9, -6, 10, -7, 8, -7,
          8, -9, 8, -9, 7, -9, 5, -10, 6, -10, 4, -10, 3,
        ],
        [
          1074, 909, -11, 1, -10, -1, -11, -2, -10, -3, -10, -4, -10, -5, -9, -6, -8, -7, -8, -8,
          -7, -8, -6, -9, -5, -10, -5, -10, -3, -10, -4, -11, -2, -10, -2, -11, -1, -11, -1, -11, 1,
          -11, 1, -11, 2, -11, 2, -11, 3, -11, 3, -10, 4, -11, 5, -10, 5, -10, 5, -10, 6, -9, 6, -9,
          7, -8, 8, -8, 8, -7, 9, -7, 10, -5, 10, -4, 10, -4, 11, -2, 10, -2, 11, 0, 11, 1, 10, 3,
          10, 3, 10, 5, 10, 5, 8, 7, 8, 7, 8, 8, 6, 9, 6, 9, 5, 10, 4, 10, 3, 11, 2, 11, 2, 11, 1,
          11, 1, 11, 0, 11, 0, 11, -1, 11, -2, 11, -2, 11, -3, 10, -4, 11, -3, 10, -5, 10, -5, 10,
          -6, 10, -6, 9, -7, 8, -8, 8, -8, 7, -9, 7, -9, 6, -10, 5, -10, 4, -10, 3,
        ],
      ],
      [
        [
          576, 664, -8, 1, -8, 0, -7, -2, -7, -4, -6, -5, -5, -6, -4, -7, -2, -8, 0, -8, 0, -8, 1,
          -8, 3, -7, 5, -7, 6, -4, 7, -4, 7, -3, 7, -3, 8, 0, 7, 2, 7, 4, 7, 3, 6, 5, 5, 6, 3, 7, 1,
          8, 0, 8, 0, 8, -3, 8, -3, 7, -5, 6, -7, 5, -7, 3,
        ],
        [
          1094, 714, -7, 1, -8, 0, -7, -3, -7, -4, -7, -3, -7, -5, -4, -6, -4, -7, -1, -8, 0, -8, 0,
          -8, 3, -7, 3, -7, 5, -7, 6, -5, 7, -4, 8, -2, 8, -1, 8, 0, 8, 2, 7, 2, 7, 4, 6, 6, 4, 6,
          4, 8, 1, 7, 1, 8, -1, 8, -2, 8, -5, 6, -6, 6, -6, 5, -7, 4,
        ],
      ],
      [],
      [
        [
          820, 857, -8, 1, -8, 0, -8, 0, -8, -1, -8, -2, -7, -1, -8, -2, -8, -2, -7, -3, -7, -5, -6,
          -6, -5, -6, -6, -5, -5, -7, -3, -7, -2, -7, 0, -8, 1, -7, 4, -6, 7, -4, 7, -1, 8, 2, 6, 4,
          5, 6, 5, 6, 6, 4, 7, 4, 7, 3, 8, 4, 7, 1, 8, 0, 8, -1, 8, -2, 7, -4, 7, -3, 6, -4, 5, -6,
          6, -5, 7, -3, 7, -1, 8, 2, 5, 5, 4, 6, 2, 8, 0, 7, -3, 7, -5, 7, -5, 5, -7, 5, -6, 5, -7,
          5, -6, 4, -7, 4, -8, 2,
        ],
      ],
      [],
    ],
    manifest: {
      version: 2,
      canonical: { width: 400, height: 420, feetY: 400 },
      bounds: [-1, 0, 410, 431],
      rest: 'wave:0',
      renderer: 'xo-morph.js',
      clips: {
        wave: {
          src: 'wave.json',
          segments: 9,
          durationMs: 2646,
          bytes: 130836,
          keys: [
            'wave:0',
            'greet4:3',
            'greet4:6',
            'greet4:9',
            'greet4:11',
            'greet4:15',
            'greet4:17',
            'greet4:18',
            'greet4:20',
            'wave:0',
          ],
          poster: 3,
          peak: 3,
          bbox: [30.1, 70.6, 377.1, 402.0],
        },
        'tour-pointLeft': {
          src: 'tour-pointLeft.json',
          segments: 6,
          durationMs: 2041,
          bytes: 94029,
          keys: ['wave:0', 'tour4:1', 'tour4:2', 'tour4:3', 'tour4:2', 'tour4:1', 'wave:0'],
          poster: 3,
          peak: 3,
          bbox: [31.5, 70.6, 384.0, 401.3],
        },
        'tour-pointRight': {
          src: 'tour-pointRight.json',
          segments: 6,
          durationMs: 2312,
          bytes: 89855,
          keys: ['wave:0', 'tour4:7', 'tour4:8', 'tour4:9', 'tour4:10', 'tour4:9', 'wave:0'],
          poster: 5,
          peak: 5,
          bbox: [21.1, 70.6, 381.2, 401.3],
        },
        'tour-present': {
          src: 'tour-present.json',
          segments: 7,
          durationMs: 2405,
          bytes: 99443,
          keys: [
            'wave:0',
            'tour4:13',
            'tour4:14',
            'tour4:15',
            'tour4:16',
            'tour4:19',
            'tour4:20',
            'wave:0',
          ],
          poster: 3,
          peak: 3,
          bbox: [31.5, 67.5, 377.1, 401.3],
        },
        blink: {
          src: 'blink.json',
          segments: 4,
          durationMs: 250,
          bytes: 48629,
          keys: ['wave:0', 'calm4:2', 'calm4:3', 'calm4:4', 'wave:0'],
          poster: 0,
          peak: 0,
          bbox: [31.5, 70.6, 377.1, 401.3],
        },
        cheer: {
          src: 'cheer.json',
          segments: 39,
          durationMs: 5186,
          bytes: 525147,
          keys: [
            'wave:0',
            'cheer4:2',
            'cheer4:3',
            'cheer4:4',
            'cheer4:5',
            'cheer4:6',
            'cheer4:7',
            'cheer4:8',
            'cheer4:10',
            'cheer4:11',
            'cheer4:12',
            'cheer4:13',
            'cheer4:14',
            'cheer4:15',
            'cheer4:16',
            'cheer4:17',
            'cheer4:18',
            'cheer4:20',
            'cheer4:21',
            'cheer4:22',
            'cheer4:23',
            'cheer4:24',
            'cheer4:25',
            'cheer4:26',
            'cheer4:27',
            'cheer4:29',
            'cheer4:30',
            'cheer4:32',
            'cheer4:33',
            'cheer4:35',
            'cheer4:36',
            'cheer4:37',
            'cheer4:38',
            'cheer4:40',
            'cheer4:41',
            'cheer4:42',
            'cheer4:44',
            'cheer4:45',
            'cheer4:46',
            'wave:0',
          ],
          poster: 32,
          peak: 32,
          bbox: [27.8, 45.9, 378.4, 403.8],
        },
        hop: {
          src: 'hop.json',
          segments: 28,
          durationMs: 3042,
          bytes: 389808,
          keys: [
            'wave:0',
            'hop4:1',
            'hop4:2',
            'hop4:3',
            'hop4:4',
            'hop4:6',
            'hop4:8',
            'hop4:9',
            'hop4:10',
            'hop4:11',
            'hop4:14',
            'hop4:16',
            'hop4:17',
            'hop4:18',
            'hop4:19',
            'hop4:20',
            'hop4:23',
            'hop4:29',
            'hop4:36',
            'hop4:38',
            'hop4:39',
            'hop4:40',
            'hop4:41',
            'hop4:42',
            'hop4:43',
            'hop4:44',
            'hop4:45',
            'hop4:46',
            'wave:0',
          ],
          poster: 6,
          peak: 0,
          bbox: [22.7, 70.6, 383.1, 404.5],
        },
        sleepy: {
          src: 'sleepy.json',
          segments: 30,
          durationMs: 4802,
          bytes: 401741,
          keys: [
            'wave:0',
            'sleepy4:2',
            'sleepy4:3',
            'sleepy4:5',
            'sleepy4:6',
            'sleepy4:8',
            'sleepy4:11',
            'sleepy4:14',
            'sleepy4:16',
            'sleepy4:17',
            'sleepy4:18',
            'sleepy4:19',
            'sleepy4:20',
            'sleepy4:23',
            'sleepy4:24',
            'sleepy4:25',
            'sleepy4:26',
            'sleepy4:28',
            'sleepy4:29',
            'sleepy4:30',
            'sleepy4:31',
            'sleepy4:33',
            'sleepy4:34',
            'sleepy4:36',
            'sleepy4:37',
            'sleepy4:38',
            'sleepy4:39',
            'sleepy4:40',
            'sleepy4:41',
            'sleepy4:43',
            'wave:0',
          ],
          poster: 14,
          peak: 14,
          bbox: [29.7, 70.6, 386.1, 406.3],
        },
        glance: {
          src: 'glance.json',
          segments: 5,
          durationMs: 1712,
          bytes: 64688,
          keys: ['wave:0', 'calm4:13', 'calm4:15', 'calm4:16', 'calm4:17', 'wave:0'],
          poster: 0,
          peak: 0,
          bbox: [31.5, 70.6, 377.1, 401.3],
        },
        nod: {
          src: 'nod.json',
          segments: 6,
          durationMs: 2527,
          bytes: 82530,
          keys: ['wave:0', 'nod4:6', 'nod4:9', 'nod4:12', 'nod4:15', 'nod4:16', 'wave:0'],
          poster: 0,
          peak: 0,
          bbox: [30.6, 70.6, 377.1, 401.3],
        },
        curious: {
          src: 'curious.json',
          segments: 35,
          durationMs: 5321,
          bytes: 520374,
          keys: [
            'wave:0',
            'curious4:1',
            'curious4:2',
            'curious4:3',
            'curious4:7',
            'curious4:8',
            'curious4:10',
            'curious4:11',
            'curious4:12',
            'curious4:13',
            'curious4:14',
            'curious4:15',
            'curious4:16',
            'curious4:17',
            'curious4:18',
            'curious4:19',
            'curious4:20',
            'curious4:21',
            'curious4:24',
            'curious4:25',
            'curious4:26',
            'curious4:27',
            'curious4:28',
            'curious4:29',
            'curious4:30',
            'curious4:31',
            'curious4:32',
            'curious4:33',
            'curious4:34',
            'curious4:35',
            'curious4:36',
            'curious4:37',
            'curious4:38',
            'curious4:39',
            'curious4:42',
            'wave:0',
          ],
          poster: 20,
          peak: 20,
          bbox: [31.5, 55.0, 387.6, 406.3],
        },
        thinking: {
          src: 'thinking.json',
          segments: 23,
          durationMs: 4016,
          bytes: 314687,
          keys: [
            'wave:0',
            'thinking4:1',
            'thinking4:2',
            'thinking4:3',
            'thinking4:6',
            'thinking4:12',
            'thinking4:15',
            'thinking4:18',
            'thinking4:19',
            'thinking4:21',
            'thinking4:22',
            'thinking4:23',
            'thinking4:24',
            'thinking4:25',
            'thinking4:26',
            'thinking4:28',
            'thinking4:29',
            'thinking4:30',
            'thinking4:32',
            'thinking4:33',
            'thinking4:38',
            'thinking4:40',
            'thinking4:42',
            'wave:0',
          ],
          poster: 12,
          peak: 12,
          bbox: [31.5, 69.2, 377.1, 408.9],
        },
        giggle: {
          src: 'giggle.json',
          segments: 19,
          durationMs: 4100,
          bytes: 266336,
          keys: [
            'wave:0',
            'giggle4:1',
            'giggle4:3',
            'giggle4:4',
            'giggle4:6',
            'giggle4:7',
            'giggle4:10',
            'giggle4:15',
            'giggle4:17',
            'giggle4:18',
            'giggle4:20',
            'giggle4:23',
            'giggle4:24',
            'giggle4:29',
            'giggle4:30',
            'giggle4:32',
            'giggle4:34',
            'giggle4:41',
            'giggle4:43',
            'wave:0',
          ],
          poster: 12,
          peak: 12,
          bbox: [22.2, 70.6, 379.4, 401.3],
        },
        uneasy: {
          src: 'uneasy.json',
          segments: 16,
          durationMs: 3609,
          bytes: 213013,
          keys: [
            'wave:0',
            'uneasy4:3',
            'uneasy4:7',
            'uneasy4:10',
            'uneasy4:14',
            'uneasy4:15',
            'uneasy4:16',
            'uneasy4:22',
            'uneasy4:23',
            'uneasy4:24',
            'uneasy4:29',
            'uneasy4:32',
            'uneasy4:33',
            'uneasy4:34',
            'uneasy4:35',
            'uneasy4:36',
            'wave:0',
          ],
          poster: 7,
          peak: 7,
          bbox: [31.5, 70.6, 387.2, 402.5],
        },
        shy: {
          src: 'shy.json',
          segments: 40,
          durationMs: 5410,
          bytes: 508626,
          keys: [
            'wave:0',
            'shy4:1',
            'shy4:2',
            'shy4:3',
            'shy4:4',
            'shy4:6',
            'shy4:8',
            'shy4:9',
            'shy4:10',
            'shy4:11',
            'shy4:12',
            'shy4:13',
            'shy4:14',
            'shy4:15',
            'shy4:16',
            'shy4:17',
            'shy4:18',
            'shy4:19',
            'shy4:20',
            'shy4:21',
            'shy4:22',
            'shy4:23',
            'shy4:26',
            'shy4:29',
            'shy4:30',
            'shy4:31',
            'shy4:32',
            'shy4:33',
            'shy4:34',
            'shy4:35',
            'shy4:36',
            'shy4:37',
            'shy4:38',
            'shy4:39',
            'shy4:40',
            'shy4:42',
            'shy4:43',
            'shy4:44',
            'shy4:45',
            'shy4:46',
            'wave:0',
          ],
          poster: 6,
          peak: 6,
          bbox: [31.5, 70.6, 378.9, 403.8],
        },
        love: {
          src: 'love.json',
          segments: 21,
          durationMs: 4238,
          bytes: 278295,
          keys: [
            'wave:0',
            'love4:1',
            'love4:2',
            'love4:3',
            'love4:4',
            'love4:8',
            'love4:10',
            'love4:11',
            'love4:12',
            'love4:14',
            'love4:16',
            'love4:17',
            'love4:22',
            'love4:24',
            'love4:32',
            'love4:35',
            'love4:37',
            'love4:38',
            'love4:41',
            'love4:42',
            'love4:44',
            'wave:0',
          ],
          poster: 14,
          peak: 14,
          bbox: [31.5, 70.6, 385.7, 402.5],
        },
        dance: {
          src: 'dance.json',
          segments: 44,
          durationMs: 6903,
          bytes: 613018,
          keys: [
            'wave:0',
            'dance4:1',
            'dance4:2',
            'dance4:3',
            'dance4:4',
            'dance4:5',
            'dance4:7',
            'dance4:8',
            'dance4:9',
            'dance4:10',
            'dance4:11',
            'dance4:12',
            'dance4:13',
            'dance4:14',
            'dance4:15',
            'dance4:16',
            'dance4:17',
            'dance4:18',
            'dance4:19',
            'dance4:20',
            'dance4:21',
            'dance4:22',
            'dance4:23',
            'dance4:24',
            'dance4:25',
            'dance4:26',
            'dance4:27',
            'dance4:28',
            'dance4:29',
            'dance4:30',
            'dance4:31',
            'dance4:32',
            'dance4:33',
            'dance4:34',
            'dance4:35',
            'dance4:36',
            'dance4:37',
            'dance4:38',
            'dance4:39',
            'dance4:40',
            'dance4:41',
            'dance4:42',
            'dance4:45',
            'dance4:46',
            'wave:0',
          ],
          poster: 28,
          peak: 28,
          bbox: [26.0, 69.1, 384.9, 406.3],
        },
      },
    },
  }; /*END EMBED*/
  const BASE =
    (document.currentScript && document.currentScript.src.replace(/[^/]*$/, '')) ||
    'assets/xo-morph-v1/'; // app pages load it from any path
  const M = EMB.manifest,
    Q = EMB.q,
    LAYERS = EMB.layers,
    NL = LAYERS.length;
  const COL = LAYERS.map((L) => EMB.col[L]);
  const LINES = LAYERS.indexOf('lines');
  const FACE = new Set(['eyes', 'hl', 'lids', 'mouth', 'tongue'].map((L) => LAYERS.indexOf(L)));
  const CLASSED = new Set(['eyes', 'mouth'].map((L) => LAYERS.indexOf(L)));
  const BIG = new Set(['body', 'gills', 'belly', 'feet', 'tail'].map((L) => LAYERS.indexOf(L)));
  const B = M.bounds; // [x0, y0, x1, y1] canonical, covers every clip + 6%
  const QUIET = ['glance', 'nod']; // hero calm beats (hero-b glance, hero-c nod); no breath: near-identical frames read as jitter
  let visibleSince = document.visibilityState === 'visible' ? 0 : Infinity;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && visibleSince === Infinity)
      visibleSince = performance.now();
  });
  const easeOut = (x) => 1 - Math.pow(1 - x, 3); // ~ --ease-out (.22,1,.36,1)
  const smooth = (x) => x * x * (3 - 2 * x);
  const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(2 - 2 * x, 3) / 2); // gaze moves: ease-in-out cubic, no overshoot
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const rand = (a, b) => a + Math.random() * (b - a);

  /* ---------- data ---------- */
  function pts(a) {
    const out = new Float32Array(a.length);
    let x = 0,
      y = 0;
    for (let i = 0; i < a.length; i += 2) {
      x += a[i];
      y += a[i + 1];
      out[i] = x / Q;
      out[i + 1] = y / Q;
    }
    return out;
  }
  function plus(A, d) {
    const out = new Float32Array(A.length);
    for (let i = 0; i < A.length; i++) out[i] = A[i] + d[i] / Q;
    return out;
  }
  // item kinds: 0 pair, 1 shrink out, 2 grow in, 3 line pair, 4 line out, 5 line in, 6 fade out in place, 7 fade in in place
  function decode(d) {
    const segs = d.segs.map((seg) =>
      seg.map((items, li) =>
        items.map((it) => {
          const A = pts(it[1]);
          if (li === LINES) {
            if (it[0] === 0) return { k: 3, A, B: plus(A, it[2]), wa: it[3] / 10, wb: it[4] / 10 };
            return { k: it[0] === 1 ? 4 : 5, A, w: it[2] / 10, dx: it[3][0] / Q, dy: it[3][1] / Q };
          }
          if (it[0] === 0) return { k: 0, A, B: plus(A, it[2]) };
          if (it[0] === 4) return { k: 6, A };
          if (it[0] === 5) return { k: 7, A };
          return {
            k: it[0],
            A,
            cx: it[2][0] / Q,
            cy: it[2][1] / Q,
            dx: it[3][0] / Q,
            dy: it[3][1] / Q,
          };
        }),
      ),
    );
    const n = segs.length;
    const rests = d.phraseMs
      ? d.keys.flatMap((k, i) => (i > 0 && i < n && k === d.keys[0] ? [i] : []))
      : []; // ad phrase clips: inner rest keys
    sizes(segs, rests); // C: no pulsing tail/feet/belly
    for (const seg of segs)
      for (const L of seg) for (const it of L) if (it.k === 0 || it.k === 3) rigid(it); // A: no melting
    segs.forEach(carry);
    link(segs); // B: C1 timeline through the keys
    const cut = new Set(d.phrases || []); // phrase boundaries (landing: the holds; ad phrase sheets: their inner rest keys)
    tangents(
      segs,
      d.dur,
      (k) => k <= 0 || k >= n || d.hold[k] > 0 || k === d.takeoff || cut.has(k),
      'tc',
    );
    if (d.phases) {
      const ends = new Set();
      for (const r of Object.values(d.phases)) ends.add(r[0]).add(r[1] + 1);
      tangents(
        segs,
        segs.map(() => 1),
        (k) => k <= 0 || k >= n || ends.has(k),
        'tp',
      );
    } // hop phases: equal time per segment
    for (const seg of segs)
      for (const L of seg)
        for (const it of L) {
          delete it.w0;
          delete it.w1;
          delete it.mp;
          delete it.mn;
          delete it.pv;
          delete it.nx;
        }
    const T = [];
    let total = 0;
    for (let k = 0; k < segs.length; k++) {
      T.push(total);
      total += d.hold[k] + d.dur[k];
    }
    T.push(total);
    return {
      id: d.id,
      segs,
      dur: d.dur,
      hold: d.hold,
      T,
      total,
      n: segs.length,
      poster: d.poster || 0,
      peak: d.peak ?? d.poster ?? 0,
      xf: !d.xf || d.xf === 120 ? SNAP : d.xf,
      xfEase: d.xfEase === 'out' ? easeOut : smooth,
      phrases: d.phrases || [0, segs.length],
      phases: d.phases || null,
      takeoff: d.takeoff ?? null,
      named: d.phraseMs || null,
      hops: d.hops || null,
      restMs: rests.map((i) => T[i]),
    }; // inner keys at the shared rest
  }
  // Face parts that change shape class (open <-> happy eye, lids, mouth, tongue, glints) swap in ONE frame at the middle
  // of the move, where it is fastest. Any cross-fade, even 20ms, is caught by a frame and shows a see-through double eye,
  // so there is no alpha ramp at all (blink and sleepy too: their xf/xfEase data is ignored).
  // tools/xo-morph/face-check.mjs fails the build if a frame ever holds a semi-transparent or doubled face part.
  const SNAP = 20;
  // Swapped parts are traced where they sit at the start (outgoing) or end (incoming) of the move. They ride on the
  // nearest morphing face shape (else the body), so a glint never floats off an eye that is still travelling.
  function carry(seg) {
    const body = seg[LAYERS.indexOf('body')]
      .filter((p) => p.k === 0)
      .sort((a, b) => b.A.length - a.A.length)[0];
    for (const li of FACE)
      for (const it of seg[li]) {
        if (it.k !== 6 && it.k !== 7) continue;
        const c = centroid(it.A);
        let best = null,
          bd = 90;
        for (const lj of FACE)
          for (const p of seg[lj])
            if (p.k === 0) {
              const q = centroid(it.k === 6 ? p.A : p.B),
                d = Math.hypot(q[0] - c[0], q[1] - c[1]);
              if (d < bd) {
                bd = d;
                best = p;
              }
            }
        best = best || body;
        if (!best) continue;
        it.cr = best;
        it.r = it.k === 6 ? best.ca : best.cb; // rides the carrier's centroid path (see cAt)
      }
  }

  /* ---------- natural motion, precomputed at decode (README "Renderer") ---------- */
  // C. Sizes: the traced tail, feet and belly change area 20-50% from key to key (generation wobble), which a morph turns
  // into pulsing. Per key, each layer is scaled toward a running median of its area (factor 0.8-1.25, ramps at most 12%
  // per key, 1 at the first and last key so clips still meet the shared rest pose). Feet scale about their ground contact,
  // the tail about its root (the point nearest the body), the belly about its centre.
  const SIZED = ['tail', 'feet', 'belly'].map((L) => LAYERS.indexOf(L)),
    BODY = LAYERS.indexOf('body'),
    FEET = LAYERS.indexOf('feet'),
    TAIL = LAYERS.indexOf('tail');
  function polyA(P) {
    let a = 0,
      x = 0,
      y = 0;
    for (let i = 0, n = P.length; i < n; i += 2) {
      const j = (i + 2) % n,
        c = P[i] * P[j + 1] - P[j] * P[i + 1];
      a += c;
      x += (P[i] + P[j]) * c;
      y += (P[i + 1] + P[j + 1]) * c;
    }
    return Math.abs(a) < 1e-6 ? [0, P[0], P[1]] : [Math.abs(a / 2), x / (3 * a), y / (3 * a)];
  }
  function sizes(segs, rests = []) {
    const n = segs.length,
      toRest = (k) => Math.min(k, n - k, ...rests.map((r) => Math.abs(k - r)));
    const atKey = (k, li) => {
      const o = []; // every traced shape of layer li at key k: [item, field]
      if (k < n)
        for (const it of segs[k][li]) {
          if (it.k === 0 || it.k === 1) o.push([it, 'A']);
        }
      if (k > 0)
        for (const it of segs[k - 1][li]) {
          if (it.k === 0) o.push([it, 'B']);
          else if (it.k === 2) o.push([it, 'A']);
        }
      return o;
    };
    const side = (k, li) =>
      atKey(k, li)
        .filter(([it, f]) => (k < n ? !(f === 'B' || it.k === 2) : true))
        .map(([it, f]) => it[f]);
    for (const li of SIZED) {
      const a = [];
      for (let k = 0; k <= n; k++) a.push(side(k, li).reduce((s, P) => s + polyA(P)[0], 0));
      const f = a.map(() => 1),
        MIN = 400;
      for (let k = 1; k < n; k++) {
        if (a[k] < MIN) continue;
        const w = [];
        for (let j = Math.max(0, k - 2); j <= Math.min(n, k + 2); j++)
          if (a[j] >= MIN) w.push(a[j]);
        w.sort((x, y) => x - y);
        f[k] = Math.min(1.25, Math.max(0.8, w[w.length >> 1] / a[k]));
      }
      for (let k = 1; k < n; k++) {
        const r = 1.12 ** toRest(k);
        f[k] = Math.min(r, Math.max(1 / r, f[k]));
      } // ramp from/to the rest pose
      for (let k = 1; k < n; k++) {
        if (Math.abs(f[k] - 1) < 0.01) continue;
        const sc = Math.sqrt(f[k]),
          body = side(k, BODY).sort((p, q) => q.length - p.length)[0],
          bc = body ? polyA(body) : null;
        for (const [it, fld] of atKey(k, li)) {
          const P = it[fld],
            c = polyA(P);
          let ax = c[1],
            ay = c[2];
          if (li === FEET) {
            ay = -1e9;
            for (let i = 1; i < P.length; i += 2) ay = Math.max(ay, P[i]);
          } else if (li === TAIL && bc) {
            let bd = Infinity;
            for (let i = 0; i < P.length; i += 2) {
              const dd = (P[i] - bc[1]) ** 2 + (P[i + 1] - bc[2]) ** 2;
              if (dd < bd) {
                bd = dd;
                ax = P[i];
                ay = P[i + 1];
              }
            }
          }
          for (let i = 0; i < P.length; i += 2) {
            P[i] = ax + (P[i] - ax) * sc;
            P[i + 1] = ay + (P[i + 1] - ay) * sc;
          }
          if (it.k === 1 || it.k === 2) {
            it.cx = ax + (it.cx - ax) * sc;
            it.cy = ay + (it.cy - ay) * sc;
          }
        }
      }
    }
  }
  // A. Rigid parts: a paired shape moves as centroid + rotation + uniform scale (2D Procrustes A -> B) plus a residual in
  // its own frame. Straight point-by-point lines cut across the chord of a swinging tail or foot and lost up to 58% area.
  function rigid(it, line = it.k === 3 || it.line) {
    // closed shapes pivot on their area centroid (the same for any point sampling)
    const A = it.A,
      B = it.B,
      n = A.length,
      ca = line ? centroid(A) : polyA(A).slice(1),
      cb = line ? centroid(B) : polyA(B).slice(1);
    let dot = 0,
      crs = 0,
      ra = 0,
      rb = 0;
    for (let i = 0; i < n; i += 2) {
      const ax = A[i] - ca[0],
        ay = A[i + 1] - ca[1],
        bx = B[i] - cb[0],
        by = B[i + 1] - cb[1];
      dot += ax * bx + ay * by;
      crs += ax * by - ay * bx;
      ra += ax * ax + ay * ay;
      rb += bx * bx + by * by;
    }
    let th = Math.atan2(crs, dot),
      ls = 0.5 * Math.log((rb + 1e-9) / (ra + 1e-9));
    if (Math.min(ra, rb) < (4 * n) / 2 || Math.abs(th) > 1.75) th = 0; // specks and ambiguous turns: no rotation
    if (Math.min(ra, rb) < (4 * n) / 2 || Math.abs(ls) > 1.1) ls = 0;
    const co = Math.cos(-th) * Math.exp(-ls),
      si = Math.sin(-th) * Math.exp(-ls),
      La = new Float32Array(n),
      Lb = new Float32Array(n);
    for (let i = 0; i < n; i += 2) {
      La[i] = A[i] - ca[0];
      La[i + 1] = A[i + 1] - ca[1];
      const x = B[i] - cb[0],
        y = B[i + 1] - cb[1];
      Lb[i] = co * x - si * y;
      Lb[i + 1] = si * x + co * y;
    }
    Object.assign(it, { ca, cb, th, ls, La, Lb });
  }
  // B. C1 timeline. Each paired shape is linked to the same traced shape in the previous and next segment (point maps
  // by nearest point, since morph.py re-matches point order per segment). At a key every point gets one velocity, the
  // duration-weighted (Bessel) blend of the two neighbouring rigid paths, limited per axis like a monotone cubic (zero
  // on a reversal, at most 3x the slower side: no overshoot). Stops only at clip start/end, holds and the takeoff key
  // (hop phases: the phase ends). The residual takes up whatever the rigid tangents do not explain.
  function link(segs) {
    for (let k = 0; k + 1 < segs.length; k++)
      for (let li = 0; li < NL; li++) {
        const P = segs[k][li].filter((it) => it.k === 0 || it.k === 3),
          Q = segs[k + 1][li].filter((it) => it.k === 0 || it.k === 3),
          c = [];
        const key = (F, line) => {
          if (line) {
            const m = centroid(F);
            return [m[0], m[1], rms(F.map((v, i) => v - m[i & 1]))];
          }
          const r = polyA(F);
          return [r[1], r[2], Math.sqrt(r[0])];
        };
        const kp = P.map((p) => key(p.B, p.k === 3)),
          kq = Q.map((q) => key(q.A, q.k === 3));
        P.forEach((p, i) =>
          Q.forEach((q, j) => {
            const a = kp[i],
              b = kq[j],
              d = Math.hypot(a[0] - b[0], a[1] - b[1]);
            if (p.k === q.k && d < 3 && Math.abs(Math.log((a[2] + 1e-6) / (b[2] + 1e-6))) < 0.1)
              c.push([d, p, q]);
          }),
        );
        c.sort((x, y) => x[0] - y[0]);
        for (const [, p, q] of c) {
          if (p.nx || q.pv) continue;
          p.nx = q;
          q.pv = p;
          p.mn = near(p.B, q.A);
          q.mp = near(q.A, p.B);
        }
      }
  }
  function rms(L) {
    let s = 0;
    for (let i = 0; i < L.length; i++) s += L[i] * L[i];
    return Math.sqrt(s / (L.length / 2)) + 1e-6;
  }
  function near(F, G) {
    // for each point of F, the offset of the nearest point of G (same traced contour, different sampling)
    const n = G.length / 2,
      key = new Float64Array(n),
      o = new Int32Array(n),
      xs = new Float64Array(n),
      m = new Int32Array(F.length / 2);
    for (let j = 0; j < n; j++) key[j] = Math.round(G[2 * j] * 1024) * 65536 + j; // x (1/1024 px) and index in one number: native sort
    key.sort();
    for (let q = 0; q < n; q++) {
      const j = key[q] % 65536;
      o[q] = 2 * j;
      xs[q] = G[2 * j];
    }
    for (let i = 0; i < F.length; i += 2) {
      // sweep outward from F's x in G sorted by x, stop once x alone is farther than the best
      const fx = F[i],
        fy = F[i + 1];
      let lo = 0,
        hi = n;
      while (lo < hi) {
        const md = (lo + hi) >> 1;
        if (xs[md] < fx) lo = md + 1;
        else hi = md;
      }
      let bd = Infinity,
        bj = 0;
      for (let q = lo; q < n && (xs[q] - fx) ** 2 < bd; q++) {
        const j = o[q],
          d = (G[j] - fx) ** 2 + (G[j + 1] - fy) ** 2;
        if (d < bd) {
          bd = d;
          bj = j;
        }
      }
      for (let q = lo - 1; q >= 0 && (xs[q] - fx) ** 2 < bd; q--) {
        const j = o[q],
          d = (G[j] - fx) ** 2 + (G[j + 1] - fy) ** 2;
        if (d < bd) {
          bd = d;
          bj = j;
        }
      }
      m[i >> 1] = bj;
    }
    return m;
  }
  function blend(vm, vp, hm, hp) {
    // velocity at a key from the incoming (vm, segment hm long) and outgoing (vp, hp) rates
    if (vm * vp <= 0) return 0;
    const v = (hp * vm + hm * vp) / (hm + hp),
      lim = 3 * Math.min(Math.abs(vm), Math.abs(vp));
    return v > lim ? lim : v < -lim ? -lim : v;
  }
  function tangents(segs, dur, pin, key) {
    const n = segs.length;
    for (let k = 0; k < n; k++)
      for (const L of segs[k])
        for (const it of L) {
          // shape-change (residual) rates in world space at both ends, per ms
          if (it.k !== 0 && it.k !== 3) continue;
          const N = it.A.length,
            h = dur[k],
            s = Math.exp(it.ls),
            co = s * Math.cos(it.th),
            si = s * Math.sin(it.th),
            w0 = new Float32Array(N),
            w1 = new Float32Array(N);
          for (let i = 0; i < N; i += 2) {
            const Dx = (it.Lb[i] - it.La[i]) / h,
              Dy = (it.Lb[i + 1] - it.La[i + 1]) / h;
            w0[i] = Dx;
            w0[i + 1] = Dy;
            w1[i] = co * Dx - si * Dy;
            w1[i + 1] = si * Dx + co * Dy;
          }
          it.w0 = w0;
          it.w1 = w1;
        }
    const rates = (it, h) => [
      (it.cb[0] - it.ca[0]) / h,
      (it.cb[1] - it.ca[1]) / h,
      it.th / h,
      it.ls / h,
    ];
    for (let k = 0; k < n; k++)
      for (const L of segs[k])
        for (const it of L) {
          if (it.k !== 0 && it.k !== 3) continue;
          const h = dur[k],
            N = it.A.length,
            p0 = pin(k),
            p1 = pin(k + 1),
            pv = !p0 && it.pv,
            nx = !p1 && it.nx,
            hm = pv ? dur[k - 1] : 0,
            hp = nx ? dur[k + 1] : 0;
          const own = rates(it, h),
            pr = pv && rates(pv, hm),
            nr = nx && rates(nx, hp);
          // rigid tangents (segment units): one set per shape, monotone-limited, so every point of a part moves and turns together
          const r0 = own.map((v, j) => (p0 ? 0 : (pv ? blend(pr[j], v, hm, h) : v) * h)),
            r1 = own.map((v, j) => (p1 ? 0 : (nx ? blend(v, nr[j], h, hp) : v) * h));
          // residual tangents: Bessel blend of the neighbouring shape-change rates, damped per shape (never per point, which
          // would distort it) by how much the two changes agree: a reversing or jittery change eases out, a steady one flows on
          const L0 = new Float32Array(N),
            L1 = new Float32Array(N),
            s = Math.exp(it.ls),
            co = Math.cos(-it.th) / s,
            si = Math.sin(-it.th) / s;
          const lam0 = pv ? agree(pv.w1, it.w0, it.mp, hm, h, 0) : 1,
            lam1 = nx ? agree(it.w1, nx.w0, it.mn, h, hp, 1) : 1;
          for (let i = 0; i < N; i += 2) {
            const a = pv ? it.mp[i >> 1] : 0,
              b = nx ? it.mn[i >> 1] : 0;
            for (let e = 0; e < 2; e++)
              L0[i + e] = p0
                ? 0
                : (pv ? (lam0 * (h * pv.w1[a + e] + hm * it.w0[i + e])) / (hm + h) : it.w0[i + e]) *
                  h;
            const x = p1
                ? 0
                : (nx ? (lam1 * (hp * it.w1[i] + h * nx.w0[b])) / (h + hp) : it.w1[i]) * h,
              y = p1
                ? 0
                : (nx ? (lam1 * (hp * it.w1[i + 1] + h * nx.w0[b + 1])) / (h + hp) : it.w1[i + 1]) *
                  h;
            L1[i] = co * x - si * y;
            L1[i + 1] = si * x + co * y; // into the shape's own frame at t = 1
          }
          it[key] = {
            c0: [r0[0], r0[1]],
            c1: [r1[0], r1[1]],
            t0: r0[2],
            t1: r1[2],
            l0: r0[3],
            l1: r1[3],
            L0,
            L1,
          };
        }
  }
  // agreement of the incoming (wm, segment hm) and outgoing (wp, hp) shape-change rates at one key, over the points of the
  // side that owns the map (side 0: wp's points, map into wm; side 1: wm's points, map into wp): cosine, capped so the
  // blended rate is at most 1.5x the calmer side
  function agree(wm, wp, map, hm, hp, side) {
    let dot = 0,
      nm = 0,
      np = 0,
      nb = 0;
    for (let q = 0; q < map.length; q++) {
      const i = side ? 2 * q : map[q],
        j = side ? map[q] : 2 * q;
      const ax = wm[i],
        ay = wm[i + 1],
        bx = wp[j],
        by = wp[j + 1],
        cx = (hp * ax + hm * bx) / (hm + hp),
        cy = (hp * ay + hm * by) / (hm + hp);
      dot += ax * bx + ay * by;
      nm += ax * ax + ay * ay;
      np += bx * bx + by * by;
      nb += cx * cx + cy * cy;
    }
    if (dot <= 0 || !nb) return 0;
    return (
      Math.min(1, dot / Math.sqrt(nm * np)) * Math.min(1, 1.5 * Math.sqrt(Math.min(nm, np) / nb))
    );
  }
  function basis(t) {
    const t2 = t * t,
      t3 = t2 * t;
    return [2 * t3 - 3 * t2 + 1, t3 - 2 * t2 + t, -2 * t3 + 3 * t2, t3 - t2];
  }
  function cAt(it, g, h) {
    return [
      h[0] * it.ca[0] + h[1] * g.c0[0] + h[2] * it.cb[0] + h[3] * g.c1[0],
      h[0] * it.ca[1] + h[1] * g.c0[1] + h[2] * it.cb[1] + h[3] * g.c1[1],
    ];
  }
  function shift(A, dx, dy) {
    if (Math.abs(dx) + Math.abs(dy) < 0.05) return A;
    const P = new Float32Array(A.length);
    for (let i = 0; i < A.length; i += 2) {
      P[i] = A[i] + dx;
      P[i + 1] = A[i + 1] + dy;
    }
    return P;
  }
  function decodePose(enc) {
    return enc.map((items, li) =>
      items.map((it) =>
        li === LINES
          ? { P: pts(it[0]), line: true, w: it[1] / 10, a: 1 }
          : { P: pts(it), line: false, a: 1 },
      ),
    );
  }
  const REST = decodePose(EMB.rest);

  /* ---------- loading: lazy, prioritised, one at a time ---------- */
  const store = new Map();
  const queue = [];
  let inflight = 0;
  let posesP = null;
  const EXTRA = {}; // ad-only clips registered by load(ids, {base}): id -> manifest entry with an absolute src
  function pump() {
    while (inflight < 1 && queue.length) {
      // one at a time: the hero greeting never shares bandwidth
      queue.sort((a, b) => a.pri - b.pri);
      const job = queue.shift();
      inflight++;
      fetch(/^([a-z]+:|\/)/i.test(job.src) ? job.src : BASE + job.src)
        .then((r) => {
          if (!r.ok) throw new Error('Xo morph data not ready: ' + job.src);
          return r.json();
        })
        .then(job.resolve, job.reject)
        .finally(() => {
          inflight--;
          pump();
        });
    }
  }
  function get(src, pri, job = {}) {
    return new Promise((resolve, reject) => {
      Object.assign(job, { src, pri, resolve, reject });
      queue.push(job);
      pump();
    });
  }
  function clip(id, pri = 1) {
    const m = M.clips[id] || EXTRA[id];
    if (!m) return Promise.reject(new Error('No Xo morph clip ' + id));
    let e = store.get(id);
    if (!e) {
      e = { data: null, p: null, job: {} };
      store.set(id, e);
      e.p = get(m.src, pri, e.job)
        .then((d) => (e.data = decode(d)))
        .catch((err) => {
          store.delete(id);
          throw err;
        });
    } else if (pri < e.job.pri) e.job.pri = pri; // still queued: what is needed now goes first
    return e.p;
  }
  const loaded = (id) => store.get(id)?.data || null;
  // poster and peak poses for every clip (cards and reduced motion), so they never need a full clip
  const poseData = {};
  function poses(pri = 1) {
    if (!posesP)
      posesP = get('poses.json', pri)
        .then((d) => {
          for (const [id, v] of Object.entries(d)) {
            const po = decodePose(v.poster);
            poseData[id] = { poster: po, peak: v.peak ? decodePose(v.peak) : po };
          }
          return poseData;
        })
        .catch((e) => {
          posesP = null;
          throw e;
        });
    return posesP;
  }

  /* ---------- evaluating and drawing poses ---------- */
  // ms since a clip started -> [segment, t, u] (both linear time in the segment; the C1 curves live in evalPose);
  // past the end it rests on the shared rest pose
  function at(c, ms) {
    if (!(ms > 0)) return [0, 0, 0];
    if (ms >= c.total) return [c.n - 1, 1, 1];
    let k = c.n - 1;
    for (let i = 1; i < c.n; i++)
      if (c.T[i] > ms) {
        k = i - 1;
        break;
      }
    const lt = ms - c.T[k];
    if (lt < c.hold[k]) return [k, 0, 0];
    const u = Math.min(1, (lt - c.hold[k]) / c.dur[k]);
    return [k, u, u];
  }
  function xfade(c, s, u) {
    return u < 0.5 ? 0 : 1;
  } // hard swap, see SNAP
  function evalPose(c, s, t, u, ph) {
    // ph: hop phase timing (equal time per segment)
    const seg = c.segs[s],
      out = [],
      hb = basis(t),
      tg = ph ? 'tp' : 'tc';
    for (let li = 0; li < NL; li++) {
      const L = [];
      out.push(L);
      for (const it of seg[li]) {
        const A = it.A,
          n = A.length;
        let P,
          a = 1,
          w = 0;
        if (it.k === 0 || it.k === 3) {
          const g = it[tg] || it.tc,
            [cx, cy] = cAt(it, g, hb),
            La = it.La,
            Lb = it.Lb,
            L0 = g.L0,
            L1 = g.L1,
            [h0, h1, h2, h3] = hb;
          const th = h1 * g.t0 + h2 * it.th + h3 * g.t1,
            sc = Math.exp(h1 * g.l0 + h2 * it.ls + h3 * g.l1),
            co = sc * Math.cos(th),
            si = sc * Math.sin(th);
          P = new Float32Array(n);
          for (let i = 0; i < n; i += 2) {
            const x = h0 * La[i] + h1 * L0[i] + h2 * Lb[i] + h3 * L1[i],
              y = h0 * La[i + 1] + h1 * L0[i + 1] + h2 * Lb[i + 1] + h3 * L1[i + 1];
            P[i] = cx + co * x - si * y;
            P[i + 1] = cy + si * x + co * y;
          }
          if (it.k === 3) w = it.wa + (it.wb - it.wa) * t;
        } else if (it.k === 6 || it.k === 7) {
          const x = xfade(c, s, u),
            q = it.cr;
          a = it.k === 6 ? 1 - x : x;
          if (q) {
            const p = cAt(q, q[tg] || q.tc, hb);
            P = shift(A, p[0] - it.r[0], p[1] - it.r[1]);
          } else P = A;
        } else {
          // parts that appear or vanish (tail pieces behind the body, arm seams): area grows linearly (sqrt scale) and they
          // are solid except at the very start, so a split tail never drains away mid-move and seams never ghost
          const out_ = it.k === 1 || it.k === 4,
            g = out_ ? 1 - t : t,
            dk = out_ ? t : 1 - t,
            sc = it.k >= 4 ? g : Math.sqrt(g);
          a = Math.min(1, g * 4);
          let mx, my;
          if (it.k >= 4) {
            const h = (n >> 2) << 1;
            mx = A[h];
            my = A[h + 1];
            w = it.w;
          } else {
            mx = it.cx;
            my = it.cy;
          }
          P = new Float32Array(n);
          for (let i = 0; i < n; i += 2) {
            P[i] = mx + (A[i] - mx) * sc + it.dx * dk;
            P[i + 1] = my + (A[i + 1] - my) * sc + it.dy * dk;
          }
        }
        if (a > 0.005) L.push({ P, line: li === LINES, w, a });
      }
    }
    return out;
  }
  function closed(ctx, P) {
    const n = P.length;
    ctx.beginPath();
    ctx.moveTo((P[n - 2] + P[0]) / 2, (P[n - 1] + P[1]) / 2);
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n;
      ctx.quadraticCurveTo(P[i], P[i + 1], (P[i] + P[j]) / 2, (P[i + 1] + P[j + 1]) / 2);
    }
    ctx.closePath();
    ctx.fill();
  }
  function open(ctx, P, w) {
    const n = P.length;
    ctx.beginPath();
    ctx.moveTo(P[0], P[1]);
    for (let i = 2; i < n - 2; i += 2)
      ctx.quadraticCurveTo(P[i], P[i + 1], (P[i] + P[i + 2]) / 2, (P[i + 1] + P[i + 3]) / 2);
    ctx.lineTo(P[n - 2], P[n - 1]);
    ctx.lineWidth = w;
    ctx.stroke();
  }
  function drawPose(ctx, pose) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let li = 0; li < NL; li++) {
      const L = pose[li];
      if (!L.length) continue;
      ctx.fillStyle = ctx.strokeStyle = COL[li];
      for (const s of L) {
        ctx.globalAlpha = s.a;
        if (s.line) open(ctx, s.P, s.w);
        else closed(ctx, s.P);
      }
    }
    ctx.globalAlpha = 1;
  }
  // gaze (look vector gx, gy in -1..1): the face slides inside the head (up to 7 x 5 canonical px) and the whole Xo
  // leans toward gx about the feet contact (200, 400) by up to 3deg plus 2px. Rigid moves only: no part deforms.
  const GAZE = { x: 7, y: 5, lean: (3 * Math.PI) / 180, shift: 2, ms: 380 };
  function gazePose(pose, gx, gy) {
    if (Math.abs(gx) + Math.abs(gy) < 1e-4) return pose;
    const th = gx * GAZE.lean,
      co = Math.cos(th),
      si = Math.sin(th),
      fx = gx * GAZE.x,
      fy = gy * GAZE.y,
      sx = gx * GAZE.shift;
    return pose.map((L, li) =>
      L.map((s) => {
        const f = FACE.has(li),
          A = s.P,
          P = new Float32Array(A.length);
        for (let i = 0; i < A.length; i += 2) {
          const x = A[i] + (f ? fx : 0) - 200,
            y = A[i + 1] + (f ? fy : 0) - 400;
          P[i] = 200 + sx + co * x - si * y;
          P[i + 1] = 400 + si * x + co * y;
        }
        return { ...s, P };
      }),
    );
  }

  /* ---------- generic pose-to-pose blend (settle to rest, card poses, stage hand-offs) ---------- */
  function centroid(P) {
    let x = 0,
      y = 0;
    const n = P.length / 2;
    for (let i = 0; i < P.length; i += 2) {
      x += P[i];
      y += P[i + 1];
    }
    return [x / n, y / n];
  }
  function span(P) {
    let x0 = 1e9,
      x1 = -1e9,
      y0 = 1e9,
      y1 = -1e9;
    for (let i = 0; i < P.length; i += 2) {
      x0 = Math.min(x0, P[i]);
      x1 = Math.max(x1, P[i]);
      y0 = Math.min(y0, P[i + 1]);
      y1 = Math.max(y1, P[i + 1]);
    }
    return Math.max(x1 - x0, y1 - y0);
  }
  function shapeClass(P) {
    // same rule as tools/xo-morph/morph.py shape_class
    let x0 = 1e9,
      x1 = -1e9,
      y0 = 1e9,
      y1 = -1e9,
      area = 0;
    const n = P.length;
    for (let i = 0; i < n; i += 2) {
      const x = P[i],
        y = P[i + 1],
        j = (i + 2) % n;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      area += x * P[j + 1] - P[j] * y;
    }
    const w = x1 - x0 + 1e-6,
      h = y1 - y0 + 1e-6;
    area = Math.abs(area / 2);
    if (h / w > 0.85 && area / (w * h) > 0.68) return 'open';
    const cx = (x0 + x1) / 2;
    let ms = 0,
      mn = 0,
      es = 0,
      en = 0;
    for (let i = 0; i < n; i += 2) {
      const d = Math.abs(P[i] - cx);
      if (d < 0.15 * w) {
        ms += P[i + 1];
        mn++;
      } else if (d > 0.35 * w) {
        es += P[i + 1];
        en++;
      }
    }
    return mn && en && ms / mn < es / en ? 'happy' : 'closed';
  }
  function resample(P, N, isClosed) {
    const n = P.length / 2,
      segs = isClosed ? n : n - 1,
      cum = new Float32Array(segs + 1);
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n;
      cum[i + 1] = cum[i] + Math.hypot(P[2 * j] - P[2 * i], P[2 * j + 1] - P[2 * i + 1]);
    }
    const L = cum[segs] || 1,
      out = new Float32Array(N * 2);
    let k = 0;
    for (let q = 0; q < N; q++) {
      const d = isClosed ? (L * q) / N : (L * q) / (N - 1);
      while (k < segs - 1 && cum[k + 1] < d) k++;
      const j = (k + 1) % n,
        f = (d - cum[k]) / (cum[k + 1] - cum[k] || 1);
      out[2 * q] = P[2 * k] + (P[2 * j] - P[2 * k]) * f;
      out[2 * q + 1] = P[2 * k + 1] + (P[2 * j + 1] - P[2 * k + 1]) * f;
    }
    return out;
  }
  function align(A, Bp, N) {
    // best cyclic shift of B against A
    const cost = (s) => {
      let c = 0;
      for (let i = 0; i < N; i += 2) {
        const j = (i + s) % N;
        c += (A[2 * i] - Bp[2 * j]) ** 2 + (A[2 * i + 1] - Bp[2 * j + 1]) ** 2;
      }
      return c;
    };
    const step = Math.max(1, Math.floor(N / 48));
    let best = 0,
      bc = Infinity;
    for (let s = 0; s < N; s += step) {
      const c = cost(s);
      if (c < bc) {
        bc = c;
        best = s;
      }
    }
    for (let s = best - step; s <= best + step; s++) {
      const ss = (s + N) % N,
        c = cost(ss);
      if (c < bc) {
        bc = c;
        best = ss;
      }
    }
    const out = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const j = (i + best) % N;
      out[2 * i] = Bp[2 * j];
      out[2 * i + 1] = Bp[2 * j + 1];
    }
    return out;
  }
  function blendPlan(PA, PB) {
    const plan = [];
    for (let li = 0; li < NL; li++) {
      const A = PA[li],
        Bl = PB[li],
        L = [];
      plan.push(L);
      const ca = A.map((s) => centroid(s.P)),
        cb = Bl.map((s) => centroid(s.P)),
        pairs = [];
      for (let i = 0; i < A.length; i++)
        for (let j = 0; j < Bl.length; j++)
          pairs.push([Math.hypot(ca[i][0] - cb[j][0], ca[i][1] - cb[j][1]), i, j]);
      pairs.sort((a, b) => a[0] - b[0]);
      const ua = new Set(),
        ub = new Set(),
        thr = BIG.has(li) ? 140 : li === LINES ? 45 : 70;
      for (const [d, i, j] of pairs) {
        if (d > thr || ua.has(i) || ub.has(j)) continue;
        if (CLASSED.has(li) && shapeClass(A[i].P) !== shapeClass(Bl[j].P)) continue; // never morph across eye/mouth shape classes
        if (
          CLASSED.has(li) &&
          !(span(A[i].P) < 3 * span(Bl[j].P) && span(Bl[j].P) < 3 * span(A[i].P))
        )
          continue; // a trace speck never grows into an eye over the old one
        ua.add(i);
        ub.add(j);
        const isLine = A[i].line,
          N = Math.min(420, (Math.max(A[i].P.length, Bl[j].P.length) / 2) | 0);
        const ra = resample(A[i].P, N, !isLine);
        let rb = resample(Bl[j].P, N, !isLine);
        if (isLine) {
          const fw = Math.hypot(ra[0] - rb[0], ra[1] - rb[1]),
            bw = Math.hypot(ra[0] - rb[2 * N - 2], ra[1] - rb[2 * N - 1]);
          if (bw < fw) {
            const r = new Float32Array(2 * N);
            for (let q = 0; q < N; q++) {
              r[2 * q] = rb[2 * (N - 1 - q)];
              r[2 * q + 1] = rb[2 * (N - 1 - q) + 1];
            }
            rb = r;
          }
        } else rb = align(ra, rb, N);
        const e = {
          m: 1,
          A: ra,
          B: rb,
          line: isLine,
          wa: A[i].w,
          wb: Bl[j].w,
          aa: A[i].a,
          ab: Bl[j].a,
          P: new Float32Array(2 * N),
        };
        rigid(e);
        L.push(e);
      }
      A.forEach((s, i) => {
        if (!ua.has(i)) L.push({ m: 0, out: 1, s, face: FACE.has(li) });
      });
      Bl.forEach((s, j) => {
        if (!ub.has(j)) L.push({ m: 0, out: 0, s, face: FACE.has(li) });
      });
    }
    const pairs = [...FACE].flatMap((li) => plan[li].filter((e) => e.m && !e.line));
    for (const L of plan)
      for (const e of L) {
        if (e.m || !e.face || !pairs.length) continue;
        const c = centroid(e.s.P);
        let best = null,
          bd = 90;
        for (const p of pairs) {
          const q = centroid(e.out ? p.A : p.B),
            d = Math.hypot(q[0] - c[0], q[1] - c[1]);
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        if (!best) continue;
        const a = centroid(best.A),
          b = centroid(best.B),
          r = e.out ? a : b;
        e.car = [a[0] - r[0], a[1] - r[1], b[0] - r[0], b[1] - r[1]];
      }
    return plan;
  }
  function blendPose(plan, u) {
    const x = smooth(clamp01((u - 0.25) / 0.5)),
      out = [];
    for (const L of plan) {
      const o = [];
      out.push(o);
      for (const e of L) {
        if (e.m) {
          const P = e.P,
            La = e.La,
            Lb = e.Lb,
            cx = e.ca[0] + (e.cb[0] - e.ca[0]) * u,
            cy = e.ca[1] + (e.cb[1] - e.ca[1]) * u,
            sc = Math.exp(e.ls * u),
            co = sc * Math.cos(e.th * u),
            si = sc * Math.sin(e.th * u);
          for (let i = 0; i < P.length; i += 2) {
            const x = La[i] + (Lb[i] - La[i]) * u,
              y = La[i + 1] + (Lb[i + 1] - La[i + 1]) * u;
            P[i] = cx + co * x - si * y;
            P[i + 1] = cy + si * x + co * y;
          }
          o.push({
            P,
            line: e.line,
            w: (e.wa || 0) + ((e.wb || 0) - (e.wa || 0)) * u,
            a: e.aa + (e.ab - e.aa) * u,
          });
        } else {
          const xx = e.face ? (u < 0.5 ? 0 : 1) : x,
            a = e.s.a * (e.out ? 1 - xx : xx),
            q = e.car;
          if (a > 0.005)
            o.push({
              P: q ? shift(e.s.P, q[0] + (q[2] - q[0]) * u, q[1] + (q[3] - q[1]) * u) : e.s.P,
              line: e.s.line,
              w: e.s.w,
              a,
            });
        }
      }
    }
    return out;
  }

  /* ---------- activities ---------- */
  // key where a jump leaves the ground (clip JSON `takeoff`, cheer: the end of the crouch). A `fast` start squeezes everything before it into
  // `fast` ms, so the jump leads (fixes 4/4); the renderer emits xoclip 'takeoff' when the feet leave the ground.
  function mkClip(c, t0, o) {
    const ti = c.takeoff,
      lead = ti != null ? c.T[ti] + c.hold[ti] : null,
      F = o.fast && lead > o.fast ? o.fast : null;
    const cm = (pt) => {
      const ms = pt - t0;
      return F == null ? ms : ms < F ? (ms * lead) / F : ms - F + lead;
    }; // real -> clip ms
    const end = t0 + (F == null ? c.total : c.total - lead + F);
    return {
      type: 'clip',
      c,
      t0,
      mustFinish: !!o.mustFinish,
      onEnd: o.onEnd,
      stopAt: null,
      takeAt: lead == null ? null : t0 + (F ?? lead),
      took: false,
      st(pt) {
        return at(c, cm(pt));
      },
      done(pt) {
        return pt >= (this.stopAt ?? end);
      },
      pose(pt) {
        const [s, t, u] = this.st(Math.min(pt, this.stopAt ?? Infinity));
        return evalPose(c, s, t, u);
      },
      endPose() {
        return this.stopAt != null && this.stopAt < end ? this.pose(this.stopAt) : REST;
      },
      key(pt) {
        const [s, t, u] = this.st(pt);
        return c.id + ':' + s + ':' + t.toFixed(3) + ':' + u.toFixed(2);
      },
      // during a hold nothing changes: sleep until it ends (no redraws)
      wake(pt) {
        const ms = cm(pt);
        let k = c.n - 1;
        for (let i = 1; i < c.n; i++)
          if (c.T[i] > ms) {
            k = i - 1;
            break;
          }
        const lt = ms - c.T[k];
        return lt >= 0 && lt < c.hold[k]
          ? (c.hold[k] - lt) * (F != null && ms < lead ? F / lead : 1)
          : 0;
      },
      phraseLeft(pt) {
        const ms = cm(pt);
        for (const k of c.phrases) if (c.T[k] > ms) return c.T[k] - ms;
        return 0;
      },
    };
  }
  function mkPhase(c, r, t0, dur) {
    // hop phases sampled across the parent's exact phase duration
    const span = r[1] - r[0] + 1;
    const st = (pt) => {
      const f = clamp01((pt - t0) / dur) * span;
      const s = Math.min(r[1], r[0] + Math.floor(f));
      return [s, Math.min(1, f - (s - r[0]))];
    };
    return {
      type: 'phase',
      c,
      done: (pt) => pt >= t0 + dur,
      pose(pt) {
        const [s, t] = st(pt);
        return evalPose(c, s, t, t, true);
      },
      endPose() {
        return evalPose(c, r[1], 1, 1, true);
      },
      key(pt) {
        const [s, t] = st(pt);
        return 'hop:' + s + ':' + t.toFixed(3);
      },
      wake: () => 0,
    };
  }
  function mkBlend(from, to, t0, ms, easing) {
    const plan = blendPlan(from, to);
    return {
      type: 'blend',
      to,
      done: (pt) => pt >= t0 + ms,
      pose(pt) {
        return blendPose(plan, easing(clamp01((pt - t0) / ms)));
      },
      endPose: () => to,
      key(pt) {
        return 'blend' + t0.toFixed(1) + ':' + clamp01((pt - t0) / ms).toFixed(3);
      },
      wake: () => 0,
    };
  }
  function mkHold(until, pose, tag) {
    return {
      type: 'hold',
      done: (pt) => pt >= until,
      pose: () => pose,
      endPose: () => pose,
      key: () => 'hold:' + tag,
      wake: (pt) => Math.max(1, Math.min(until - pt, 60000)),
    };
  }
  // queue entries are factories run when their turn comes
  const qSettle = (p) => {
    p.atRest = true;
    return mkBlend(p.posePose, REST, p.pt, 240, easeOut);
  };
  const qQuick = (p) => {
    p.atRest = true;
    return mkBlend(p.posePose, REST, p.pt, 120, easeOut);
  }; // a hop takes off now
  const qRest = (ms) => (p) => mkHold(p.pt + ms, REST, 'rest');

  /* ---------- player ---------- */
  const IDLE_CLIPS = new Set(['blink', 'glance', 'nod', 'hop']);
  class Player {
    constructor(canvas, root, opts = {}) {
      this.cv = canvas;
      this.root = root;
      this.hero = !!opts.hero;
      this.intent = null;
      this.act = null;
      this.queue = [];
      this.pt = 0;
      this.stage = false;
      this.stageAt = 0;
      this.ratio = 0;
      this.near = false;
      this.inView = false;
      this.paused = false;
      this.reduced = false;
      this.blinkAt = rand(4000, 7000);
      this.atRest = true;
      this.atPoster = false;
      this.posePose = REST;
      this.paint = '';
      this.welcomed = false;
      this.cheeredCue = null;
      this.thinkStart = null;
      this.thinkPause = false;
      this.cheerWait = false;
      this.prevQuiet = null;
      this.idleAt = null;
      this.replayAt = 0;
      this.playedKey = null;
      this.busy = false;
      this.gazeOn = !!opts.gaze;
      this.look = [0, 0];
      this.gz = { from: [0, 0], to: [0, 0], t0: -1e9 };
      this.layout();
      director.add(this);
    }
    layout() {
      // the canvas covers every clip's bounding box (+6%) around the 400 x 420 layout box
      const s = this.cv.style;
      s.position = 'absolute';
      s.pointerEvents = 'none';
      s.left = (B[0] / 400) * 100 + '%';
      s.top = (B[1] / 420) * 100 + '%';
      s.width = ((B[2] - B[0]) / 400) * 100 + '%';
      s.height = ((B[3] - B[1]) / 420) * 100 + '%';
    }
    destroy() {
      director.remove(this);
    }
    // intent: {kind: 'hero'|'mood'|'idle'|'poster'|'phase', clip, key, cue, heroMood, phase, phaseDur, mustFinish}
    set(intent, isEvent) {
      const prev = this.intent;
      this.intent = intent;
      this.need();
      if (this.reduced) {
        this.drawStatic();
        return;
      }
      if (prev && prev.key === intent.key) return;
      if (intent.kind === 'phase') this.phaseAt = performance.now(); // the parent's phase clock starts now (wall clock: this.pt is stale while the director sleeps)
      if (isEvent) director.claim(this);
      this.interrupt();
      director.arbitrate();
      director.wake();
    }
    setFlags(f) {
      const was = this.reduced;
      Object.assign(this, f);
      if (this.reduced) {
        this.drawStatic();
        return;
      }
      if (was) {
        this.act = null;
        this.queue = [];
        this.posePose = REST;
        this.atRest = true;
        this.atPoster = false;
        this.paint = '';
        this.need();
      } // clips were skipped while reduced
      director.arbitrate();
      director.wake();
    }
    need() {
      // load what this Xo needs once it is within a viewport of the screen (the hero: immediately)
      const I = this.intent;
      if (!I || !(this.near || this.hero)) return;
      const pri = this.hero ? 0 : 1;
      if (I.kind === 'poster' || this.reduced)
        poses(pri).then(
          () => {
            this.paint = '';
            if (this.reduced) this.drawStatic();
            else director.wake();
          },
          () => {},
        );
      if (this.reduced) return;
      const now =
        I.kind === 'hero'
          ? I.heroMood === 'thinking'
            ? 'thinking'
            : I.heroMood === 'cheering'
              ? 'cheer'
              : this.welcomed
                ? 'blink'
                : 'wave'
          : I.clip;
      if (now && M.clips[now] && !this.reduced)
        clip(now, pri - 1).then(
          () => director.wake(),
          () => {},
        );
      const want =
        I.kind === 'hero'
          ? ['wave', 'thinking', 'cheer', 'blink', ...QUIET]
          : I.kind === 'poster'
            ? []
            : I.kind === 'phase' || I.kind === 'idle'
              ? ['blink', 'hop', 'cheer']
              : I.kind === 'calm'
                ? [I.clip, 'blink', ...(I.loop ? [] : QUIET)]
                : [I.clip, 'blink', ...(I.hops ? ['hop'] : [])];
      for (const id of want)
        if (M.clips[id] && !store.has(id))
          clip(id, pri).then(
            () => director.wake(),
            () => {},
          );
    }
    poseNow() {
      return this.act ? this.act.pose(this.pt) : this.posePose;
    }
    interrupt() {
      const a = this.act,
        I = this.intent;
      if (!a) {
        this.queue = [];
        return;
      }
      if (a.type === 'clip') {
        if (a.mustFinish && I.kind !== 'phase') return; // cheer and the hero greeting play to the end; the intent waits (a hop does not)
        if (this.hero && a.c.id === 'thinking' && I.heroMood === 'thinking') return;
        // a parent-timed hop (how it works) cannot wait for the phrase: settle in 120ms and take off
        if (I.kind === 'phase') {
          this.posePose = this.poseNow();
          this.act = null;
          this.atRest = false;
          this.busy = false;
          this.queue = [qQuick];
          return;
        }
        const r = a.phraseLeft(this.pt),
          toPoster = I.kind === 'poster';
        if (r < 600) {
          a.stopAt = this.pt + r;
          this.queue = toPoster ? [] : this.hero ? [qSettle] : [qSettle, qRest(150)];
          return;
        }
        this.posePose = this.poseNow();
        this.act = null;
        this.atRest = false;
        this.queue = toPoster ? [] : this.hero ? [qSettle] : [qSettle, qRest(150)];
        return;
      }
      if (a.type === 'phase' && I.kind !== 'phase') return; // short, parent-timed: let it land
      this.posePose = this.poseNow();
      this.act = null;
      this.queue = [];
      if (a.type === 'blend' && a.to !== REST) this.atRest = false;
      if (a.type === 'blend' && a.to === REST && I.kind !== 'poster')
        this.queue = [I.kind === 'phase' ? qQuick : qSettle];
    }
    setStage(on, delay) {
      if (on === this.stage) return;
      this.stage = on;
      this.stageAt = on ? this.pt + (delay || 0) : 0;
      const a = this.act;
      if (!on && a && a.type === 'clip' && a.mustFinish) {
        // a cheer or greeting losing the stage (a hop elsewhere took it): finish the phrase if it ends within 600ms,
        // else settle now (240ms); then rest with blinks
        const r = a.phraseLeft(this.pt);
        this.busy = false;
        this.atPoster = false;
        this.queue = [qSettle];
        if (r < 600) a.stopAt = this.pt + r;
        else {
          this.posePose = this.poseNow();
          this.act = null;
          this.atRest = false;
        }
      } else if (
        !on &&
        this.act &&
        this.act.type !== 'hold' &&
        !(this.act.type === 'blend' && this.act.to === REST)
      ) {
        // losing the stage: settle to rest now (240ms) so the new winner can start 150ms after
        this.posePose = this.poseNow();
        this.act = null;
        this.atRest = false;
        this.atPoster = false;
        this.queue = [qSettle];
      } else if (on) this.interrupt();
      director.wake();
    }
    moving() {
      return !!this.act && this.act.type !== 'hold';
    }
    // gaze (opts.gaze players only): look at (lx, ly) while resting. Moves take GAZE.ms (ease-in-out) and wait for a
    // running blink; any other clip looks ahead (target 0), and a clip only starts once the gaze is back at centre.
    setLook(lx, ly) {
      const c = (v) => Math.max(-1, Math.min(1, Number(v) || 0));
      this.look = [c(lx), c(ly)];
      director.wake();
    }
    gazeAt(now) {
      const g = this.gz,
        e = easeIO(clamp01((now - g.t0) / GAZE.ms));
      return [g.from[0] + (g.to[0] - g.from[0]) * e, g.from[1] + (g.to[1] - g.from[1]) * e];
    }
    gazeLeft(now) {
      return Math.max(0, this.gz.t0 + GAZE.ms - now);
    }
    gazeAim(now) {
      const a = this.act,
        tg =
          !a || a.centre
            ? [0, 0]
            : a.type === 'hold' && a.pose() === REST
              ? this.look
              : a.type === 'clip' && a.c.id === 'blink'
                ? this.gz.to
                : [0, 0];
      const g = this.gz;
      if (tg[0] !== g.to[0] || tg[1] !== g.to[1])
        this.gz = { from: this.gazeAt(now), to: tg.slice(), t0: now };
    }
    hopLead() {
      return this.reduced || ((!this.act || this.act.type === 'hold') && this.atRest) ? 0 : 120;
    } // ms a hop starting now settles first (qQuick)
    next() {
      if (this.queue.length) return this.queue.shift()(this);
      const I = this.intent,
        pt = this.pt;
      if (!I) return mkHold(Infinity, this.posePose, 'none');
      if (I.kind === 'poster') {
        const pp = poseData[I.clip]?.poster;
        if (!pp) return mkHold(Infinity, REST, 'rest');
        if (this.atPoster) return mkHold(Infinity, pp, 'poster:' + I.clip);
        const from = this.posePose;
        this.atPoster = true;
        this.atRest = false;
        return from === REST && !this.everPlayed
          ? mkHold(Infinity, pp, 'poster:' + I.clip)
          : mkBlend(from, pp, pt, 420, easeOut); // hover out: back to the card pose
      }
      if (this.atPoster) {
        this.atPoster = false;
        this.atRest = true;
        return mkBlend(this.posePose, REST, pt, 240, easeOut);
      } // hover in
      // a parent-timed hop runs on the parent's clock: a stage handoff or another Xo settling must not eat the crouch
      const now = I.now || I.kind === 'phase';
      if (!this.stage || (pt < this.stageAt && !now))
        return this.restBlink(this.stage ? this.stageAt : Infinity);
      const quiet = now ? 0 : director.quietAt(this);
      if (performance.now() < quiet) return mkHold(pt + quiet - performance.now(), REST, 'rest'); // another Xo is still settling
      if (I.kind === 'phase') {
        // a hop starts from rest: whatever cut it (a mood clip, a mid-air restart), settle in 120ms first
        if (I.phase === 'anticipate' && !this.atRest && this.playedKey !== I.key)
          return qQuick(this);
        const c = loaded('hop');
        if (!c || this.playedKey === I.key) return mkHold(Infinity, this.posePose, 'phase-end');
        this.playedKey = I.key;
        this.atRest = I.phase === 'land';
        // stay on the parent's clock: the settle eats into the crouch, so the crouch ends when the parent takes off
        const dur = I.phaseDur || { anticipate: 260, flight: 760, land: 340 }[I.phase];
        return mkPhase(
          c,
          c.phases[I.phase],
          pt,
          Math.max(50, dur - (performance.now() - (this.phaseAt ?? performance.now()))),
        );
      }
      if (this.gazeOn && I.kind !== 'idle') {
        // clips start from a centred gaze
        const now = performance.now(),
          left = this.gazeLeft(now),
          off = this.gz.to[0] || this.gz.to[1];
        if (left > 0 || off)
          return Object.assign(mkHold(pt + (left > 0 && !off ? left : GAZE.ms), REST, 'centre'), {
            centre: true,
          });
      }
      if (I.kind === 'hero') return this.heroNext();
      if (I.kind === 'idle') return this.restBlink(Infinity);
      if (I.kind === 'calm') return this.calmNext();
      const c = loaded(I.clip);
      if (!c) return this.restBlink(pt + 200);
      if (this.playedKey !== I.key || pt >= this.replayAt) {
        // mood: play, rest 1.6-4.2s (blinking), replay
        if (!this.atRest) return qSettle(this);
        this.playedKey = I.key;
        this.replayAt = Infinity;
        this.busy = true;
        this.everPlayed = true;
        return mkClip(c, pt, {
          mustFinish: !!I.mustFinish,
          fast: I.fast,
          onEnd: (p) => {
            p.busy = false;
            p.replayAt = p.pt + rand(1600, 4200);
          },
        });
      }
      return this.restBlink(this.replayAt);
    }
    restBlink(until) {
      // hold the rest pose; blink every 4-7s
      if (!this.atRest) return qSettle(this);
      const b = loaded('blink');
      if (b && this.pt >= this.blinkAt && this.gazeOn) {
        // a due blink waits for a still gaze: 80-400ms after a move lands, or 1.5s of stillness
        const still = performance.now() - this.gz.t0 - GAZE.ms; // so it never overlaps (or delays) the next move
        if (still < 80) return mkHold(this.pt + 80 - still, REST, 'rest');
        if (still > 400 && still < 1500) return mkHold(this.pt + 1500 - still, REST, 'rest');
      }
      if (b && this.pt >= this.blinkAt) {
        this.blinkAt = this.pt + b.total + rand(4000, 7000);
        return mkClip(b, this.pt, {});
      }
      return mkHold(Math.min(until, b ? this.blinkAt : this.pt + 500), REST, 'rest');
    }
    heroNext() {
      const I = this.intent,
        pt = this.pt,
        mood = I.heroMood;
      if (!this.atRest) return qSettle(this);
      if (mood === 'wave' && !this.welcomed) {
        // greet once, 420ms after the page is visible
        const vis = performance.now() - visibleSince;
        if (vis < 420) return mkHold(pt + 420 - vis, REST, 'rest');
        const w = loaded('wave');
        if (!w) return mkHold(pt + 100, REST, 'rest');
        this.busy = true;
        return mkClip(w, pt, {
          mustFinish: true,
          onEnd: (p) => {
            p.welcomed = true;
            p.busy = false;
          },
        });
      }
      if (mood === 'thinking') {
        // loop thinking phrases (0.6-1.2s pauses) until the result
        const c = loaded('thinking');
        if (!c) return mkHold(pt + 100, REST, 'rest');
        this.welcomed = true;
        this.busy = true;
        if (this.thinkStart == null) {
          this.thinkStart = pt;
          this.thinkPause = true;
          return mkClip(c, pt, {});
        }
        this.thinkPause = !this.thinkPause;
        return this.thinkPause ? mkClip(c, pt, {}) : mkHold(pt + rand(600, 1200), REST, 'rest');
      }
      if (mood === 'cheering' && this.cheeredCue !== I.cue) {
        const c = loaded('cheer');
        if (!c) return mkHold(pt + 100, REST, 'rest');
        if (this.thinkStart != null && pt < this.thinkStart + 1200)
          return mkHold(this.thinkStart + 1200, REST, 'rest');
        if (!this.cheerWait) {
          this.cheerWait = true;
          return mkHold(pt + 150, REST, 'rest');
        } // the score lands, cheer 150ms later
        this.cheerWait = false;
        this.cheeredCue = I.cue;
        this.thinkStart = null;
        this.welcomed = true;
        this.busy = true;
        return mkClip(c, pt, {
          mustFinish: true,
          onEnd: (p) => {
            p.busy = false;
            p.idleAt = p.pt + rand(900, 3100);
          },
        });
      }
      this.busy = false;
      this.thinkStart = null;
      return this.quietNext();
    }
    calmNext() {
      // app Xo: the mood clip once (loop: thinking phrases with 0.6-1.2s pauses), then the calm idle
      const I = this.intent,
        pt = this.pt;
      if (!this.atRest) return qSettle(this);
      const c = I.clip ? loaded(I.clip) : null;
      if (I.clip && !c) return this.restBlink(pt + 200);
      if (c && (I.loop || this.playedKey !== I.key)) {
        if (I.loop && this.playedKey === I.key && (this.thinkPause = !this.thinkPause))
          return mkHold(pt + rand(600, 1200), REST, 'rest');
        this.playedKey = I.key;
        this.busy = true;
        this.everPlayed = true;
        return mkClip(c, pt, {
          onEnd: (p) => {
            p.busy = false;
            p.idleAt = p.pt + rand(900, 3100);
          },
        });
      }
      this.busy = false;
      return this.quietNext();
    }
    quietNext() {
      // calm idle: irregular rests, blinks, no repeated beat
      const pt = this.pt;
      if (this.idleAt == null) this.idleAt = pt + rand(900, 3100);
      if (pt < this.idleAt) return this.restBlink(this.idleAt);
      const pool = QUIET.filter((id) => loaded(id) && id !== this.prevQuiet);
      if (!pool.length) return this.restBlink(pt + 1000);
      const id = pool[Math.floor(Math.random() * pool.length)],
        c = loaded(id);
      this.prevQuiet = id;
      this.blinkAt = Math.max(this.blinkAt, pt + c.total + 400);
      this.idleAt = Infinity;
      return mkClip(c, pt, {
        onEnd: (p) => {
          p.idleAt = p.pt + rand(900, 3100);
        },
      });
    }
    update() {
      // advance; returns ms until another frame is needed (0 = next frame)
      for (let guard = 0; guard < 8; guard++) {
        if (!this.act) {
          this.act = this.next();
          if (this.act.type === 'clip') this.emit(this.act.c.id, 'start');
        }
        if (!this.act.done(this.pt)) break;
        const a = this.act;
        this.posePose = a.endPose();
        this.act = null;
        if (a.type === 'clip') {
          if (a.stopAt == null || a.stopAt >= a.t0 + a.c.total) this.atRest = true;
          a.onEnd?.(this);
          this.emit(a.c.id, 'end');
          director.arbitrate();
        }
        if (!this.stage) this.settledAt = performance.now();
      }
      const a = this.act;
      if (a.type === 'clip' && a.takeAt != null && !a.took && this.pt >= a.takeAt) {
        a.took = true;
        this.emit(a.c.id, 'takeoff');
      }
      if (this.gazeOn) this.gazeAim(performance.now());
      this.draw(a.key(this.pt), () => a.pose(this.pt));
      if (this.gazeOn && this.gazeLeft(performance.now()) > 0) return 0;
      return a.type === 'clip' && a.takeAt != null && !a.took
        ? Math.min(a.wake(this.pt), Math.max(0, a.takeAt - this.pt))
        : a.wake(this.pt);
    }
    emit(clipId, state) {
      this.root.dispatchEvent(
        new CustomEvent('xoclip', { bubbles: true, detail: { clip: clipId, state } }),
      );
    }
    draw(key, poseFn) {
      const cv = this.cv,
        w = this.root.clientWidth;
      if (!w) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1),
        cw = (w * (B[2] - B[0])) / 400;
      const W = Math.round(cw * dpr),
        H = Math.round(((cw * (B[3] - B[1])) / (B[2] - B[0])) * dpr);
      if (cv.width !== W || cv.height !== H) {
        cv.width = W;
        cv.height = H;
        this.paint = '';
      }
      const g = this.gazeOn && !this.reduced ? this.gazeAt(performance.now()) : null,
        look = g && Math.abs(g[0]) + Math.abs(g[1]) >= 1e-4;
      if (look) key += '|g' + g[0].toFixed(3) + ',' + g[1].toFixed(3);
      if (key === this.paint) return;
      this.paint = key;
      const ctx = cv.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const k = W / (B[2] - B[0]);
      ctx.setTransform(k, 0, 0, k, -B[0] * k, -B[1] * k);
      drawPose(ctx, look ? gazePose(poseFn(), g[0], g[1]) : poseFn());
      director.draws++;
      const d = this.root.dataset;
      d.xoRenderer = 'morph';
      d.xoFrame = key;
      d.xoClip = this.act?.c?.id || this.act?.type || 'rest';
      d.xoStage = String(this.stage);
    }
    drawStatic() {
      // reduced motion: rest, the card pose, or the clip's peak frame. No blinks, morphs or fades.
      const I = this.intent;
      let pose = REST,
        key = 'rest';
      if (I) {
        const id =
            I.kind === 'hero'
              ? I.heroMood === 'thinking'
                ? 'thinking'
                : I.heroMood === 'cheering'
                  ? 'cheer'
                  : 'wave'
              : I.clip,
          pd = poseData[id];
        if (I.kind === 'poster' && pd) {
          pose = pd.poster;
          key = 'poster:' + id;
        } else if (
          (I.kind === 'hero' || I.kind === 'mood' || I.kind === 'calm') &&
          pd &&
          !IDLE_CLIPS.has(id)
        ) {
          pose = pd.peak;
          key = 'peak:' + id;
        }
      }
      this.act = null;
      this.queue = [];
      this.posePose = pose;
      this.draw(key, () => pose);
    }
    replay() {
      // pointer replay (FAQ, cards): play the current mood clip again, claiming the stage
      const I = this.intent,
        calm = I?.kind === 'calm';
      if (
        this.reduced ||
        !(I?.kind === 'mood' || (calm && I.clip && !I.loop)) ||
        (this.act?.type === 'clip' && !(calm && IDLE_CLIPS.has(this.act.c.id)))
      )
        return;
      this.playedKey = null;
      director.claim(this);
      this.interrupt();
      director.arbitrate();
      director.wake();
    }
    redraw() {
      this.paint = '';
      const a = this.act;
      this.draw(a ? a.key(this.pt) : 'static', () => (a ? a.pose(this.pt) : this.posePose));
    }
  }

  /* ---------- director: one loop for every Xo, one animated Xo per screen ---------- */
  const director = {
    players: new Set(),
    extras: new Set(),
    waiting: new Set(),
    winner: null,
    raf: 0,
    timer: 0,
    last: 0,
    draws: 0,
    claims: new Map(),
    io: null,
    init() {
      if (this.io) return;
      this.io = new IntersectionObserver(
        (es) => {
          for (const e of es) {
            const q = e.target.__xo;
            if (!q) continue;
            q.ratio = e.intersectionRatio;
            q.inView = e.isIntersecting;
            if (q.onView) q.onView();
          }
          this.arbitrate();
          this.wake();
        },
        { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] },
      );
      this.nearIo = new IntersectionObserver(
        (es) => {
          for (const e of es) {
            const q = e.target.__xo;
            if (!q) continue;
            q.near = e.isIntersecting;
            if (q.near && q.need) q.need();
          }
        },
        { rootMargin: '100% 0px 100% 0px' },
      );
      addEventListener(
        'scroll',
        () => {
          if (!this.sTimer)
            this.sTimer = setTimeout(() => {
              this.sTimer = 0;
              this.arbitrate();
            }, 150);
        },
        { passive: true },
      );
      document.addEventListener('visibilitychange', () => {
        this.last = 0;
        this.wake();
      });
    },
    observe(x) {
      this.init();
      x.root.__xo = x;
      this.io.observe(x.root);
      this.nearIo.observe(x.root);
    },
    add(p) {
      this.players.add(p);
      this.observe(p);
    },
    // flipbook Xos (the Dancing card) join the stage through an adapter: {root, candidate(), setStage(on)}
    addExtra(x) {
      x.ratio = 0;
      x.inView = false;
      this.extras.add(x);
      this.observe(x);
    },
    remove(p) {
      this.players.delete(p);
      this.extras.delete(p);
      this.waiting.delete(p);
      this.io?.unobserve(p.root);
      this.nearIo?.unobserve(p.root);
      if (this.winner === p) {
        this.winner = null;
        this.arbitrate();
      }
    },
    claim(p) {
      this.claims.set(p, performance.now());
    },
    // a parent-timed hopper counts while any of it shows: at 375 the How Xo takes off from a card scrolled half off the top
    candidate(p) {
      return (
        p.inView &&
        (p.ratio >= 0.6 || p.intent?.kind === 'phase') &&
        !p.paused &&
        !p.reduced &&
        !document.hidden &&
        (p.candidate ? p.candidate() : !!p.intent && p.intent.kind !== 'poster')
      );
    },
    // the stage goes to the Xo nearest the reading line (40% down): after a jump to a short section (Problem at 1440) its
    // Xo sits high, and the next section's Xo half a screen lower must not win the one animated slot
    arbitrate() {
      const all = [...this.players, ...this.extras].filter((p) => this.candidate(p)),
        now = performance.now(),
        mid = innerHeight * 0.4;
      const dist = (p) => {
        const r = p.root.getBoundingClientRect();
        return Math.abs(r.top + r.height / 2 - mid);
      };
      let w = this.winner && all.includes(this.winner) ? this.winner : null;
      let fresh = all.filter((p) => now - (this.claims.get(p) ?? -1e9) < 400);
      for (const [p, t] of this.claims)
        if (now - t >= 400 || fresh.includes(p)) this.claims.delete(p); // simultaneous events: closest wins, the rest are dropped
      // a winner playing a mustFinish clip (cheer, hero greeting) keeps the stage: claims wait for its end, then take the stage
      const lock = w && w.act && w.act.type === 'clip' && w.act.mustFinish;
      // a winner mid-hop (parent-timed, it is moving on screen anyway) keeps the stage until it lands; claims meanwhile are dropped
      const hop = w && w.intent?.kind === 'phase' && w.moving();
      // a hop on another Xo is parent-timed and cannot wait: it takes the stage even from a cheer or the hero greeting
      const hopper =
        !hop &&
        all
          .filter((p) => p !== w && p.intent?.kind === 'phase')
          .sort((a, b) => dist(a) - dist(b))[0];
      if (hopper) {
        w = hopper;
        fresh = [];
      } else if (lock) {
        for (const p of fresh) if (p !== w) this.waiting.add(p);
        fresh = [];
      } else if (hop) fresh = [];
      else {
        if (!fresh.length) fresh = all.filter((p) => this.waiting.has(p));
        this.waiting.clear();
      }
      if (fresh.length) {
        fresh.sort((a, b) => dist(a) - dist(b));
        w = fresh[0];
      } else if (!w || !(w.busy || hop)) {
        const best = all.slice().sort((a, b) => dist(a) - dist(b))[0] || null;
        if (!w || (best && best !== w && dist(best) < dist(w) - innerHeight * 0.1)) w = best;
      }
      if (w === this.winner) return;
      const old = this.winner;
      this.winner = w;
      if (old && old.moving()) this.handoff = now + 390; // the old winner settles (240ms), the next one starts 150ms later
      if (old) old.setStage(false);
      if (w) w.setStage(true, Math.max(0, (this.handoff || 0) - now));
      this.wake();
    },
    // a new winner starts 150ms after every other Xo has finished settling
    quietAt(me) {
      let t = 0;
      for (const q of this.players) {
        if (q === me || !this.running(q)) continue;
        if (q.act && (q.act.type === 'blend' || (q.act.type === 'clip' && q.act.c.id !== 'blink')))
          return performance.now() + 50;
        t = Math.max(t, (q.settledAt || 0) + 150);
      }
      return t;
    },
    running(p) {
      return p.inView && !p.paused && !p.reduced && !document.hidden && !!p.intent;
    },
    wake() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = 0;
      }
      if (!this.raf && !document.hidden) {
        if (!this.last) this.slept = false;
        this.raf = requestAnimationFrame(this.tick);
      }
    },
    tick: (now) => {
      const d = director;
      d.raf = 0;
      if (document.hidden) {
        d.last = 0;
        return;
      }
      const dt = d.last ? Math.min(d.slept ? 60000 : 100, now - d.last) : 0;
      d.last = now;
      d.slept = false;
      let soon = Infinity;
      for (const p of d.players) {
        if (!d.running(p)) continue;
        p.pt += dt;
        soon = Math.min(soon, p.update());
      }
      if (soon <= 20) d.raf = requestAnimationFrame(d.tick);
      else if (soon < Infinity) {
        d.slept = true;
        d.timer = setTimeout(() => {
          d.timer = 0;
          d.raf = requestAnimationFrame(d.tick);
        }, soon - 12);
      } else d.last = 0;
    },
  };

  /* ---------- deterministic API for frame-stepped renderers (marketing/ads/kit/xoclip.js) ----------
     Pure functions of their arguments: no rAF, timers, wall clock or randomness, and the Player/director are not involved.
     Same maths as the landing: sample() is a clip's C1 timeline (continuous velocity through keys, rigid per-shape moves,
     hard one-frame face swaps), blend() is the landing's settle/hand-off blend, look() is the Player gaze (setLook). */
  const bases = new Map();
  const absBase = (b) => {
    b = b.endsWith('/') ? b : b + '/';
    return /^([a-z]+:|\/)/i.test(b) || typeof location === 'undefined'
      ? b
      : new URL(b, location.href).href;
  };
  // load(ids, {base}) -> Promise<clip data[]>. base: a folder with its own manifest.json (ad-only clips built with
  // XO_OUT=<dir> tools/xo-morph/morph.py). Its ids are registered once; landing ids always win.
  async function load(ids, o = {}) {
    if (o.base) {
      const b = absBase(o.base);
      if (!bases.has(b))
        bases.set(
          b,
          get(b + 'manifest.json', 0)
            .then((m) => {
              for (const [id, e] of Object.entries(m.clips))
                if (!M.clips[id]) EXTRA[id] = { ...e, src: b + e.src };
            })
            .catch((e) => {
              bases.delete(b);
              throw e;
            }),
        );
      await bases.get(b);
    }
    return Promise.all(ids.map((id) => clip(id, 0)));
  }
  const need = (id) => {
    const c = loaded(id);
    if (!c) throw new Error('XoMorph: load(["' + id + '"]) before sampling it');
    return c;
  };
  // timing of a loaded clip in its own ms: total, takeoff (feet leave the ground) and hop phases {anticipate, flight, land: [ms0, ms1]};
  // ad phrase clips add phrases {name: [ms0, ms1]} and hops {name: {takeoff, land}} (container hop t0/t1, clip ms)
  function info(id) {
    const c = need(id),
      ph = {},
      tk = c.takeoff != null ? c.T[c.takeoff] + c.hold[c.takeoff] : null;
    if (c.phases) for (const [k, r] of Object.entries(c.phases)) ph[k] = [c.T[r[0]], c.T[r[1] + 1]];
    return {
      id,
      total: c.total,
      takeoff: tk,
      phases: c.phases ? ph : null,
      phrases: c.named,
      hops: c.hops,
      restMs: c.restMs,
    };
  }
  // pose of clip `id` at `ms` of its own time (<= 0: first key, >= total: last key, both the shared rest). 'rest' -> REST.
  function sample(id, ms) {
    if (id == null || id === 'rest') return REST;
    const c = need(id),
      [s, t, u] = at(c, ms);
    return evalPose(c, s, t, u);
  }
  // pose between a and b at u (0..1, pass it eased: ease.out is the landing's settle). The plan is cached per pose pair,
  // so keep a and b as the same objects across frames (freeze them once) and the blend stays stable frame to frame.
  const plans = new WeakMap();
  function blendPoses(a, b, u) {
    if (!(u > 0)) return a;
    if (u >= 1) return b;
    let m = plans.get(a);
    if (!m) plans.set(a, (m = new WeakMap()));
    let plan = m.get(b);
    if (!plan) m.set(b, (plan = blendPlan(a, b)));
    return blendPose(plan, u).map((L) => L.map((sh) => ({ ...sh, P: sh.P.slice() }))); // blendPose reuses its buffers
  }
  // gaze as a pure function: lx, ly in -1..1 (Xo's own frame: +x = towards his right side of the canvas before any flip)
  const c1 = (v) => Math.max(-1, Math.min(1, Number(v) || 0));
  function look(pose, lx, ly) {
    return gazePose(pose, c1(lx), c1(ly));
  }
  // where a gaze move from `from` to `to` ([lx, ly]) is after `ms` (the Player's GAZE.ms ease-in-out)
  function gazeMove(from, to, ms, dur = GAZE.ms) {
    const e = easeIO(clamp01(ms / dur));
    return [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e];
  }
  // draw a pose: (x, y) = where the feet contact (canonical 200, 400) lands in ctx px, scale = ctx px per canonical px
  // (Xo at rest is ~350 canonical px wide), flipX mirrors about x, look = [lx, ly] gaze. ctx state is restored.
  function draw(ctx, pose, o = {}) {
    const k = o.scale ?? 1;
    if (o.look) pose = look(pose, o.look[0], o.look[1]);
    ctx.save();
    ctx.transform(o.flipX ? -k : k, 0, 0, k, o.x ?? 0, o.y ?? 0);
    ctx.translate(-200, -400);
    drawPose(ctx, pose);
    ctx.restore();
  }

  window.XoMorph = {
    manifest: M,
    bounds: B,
    REST,
    clip,
    loaded,
    poses,
    poseData,
    at,
    evalPose,
    drawPose,
    blendPlan,
    blendPose,
    gazePose,
    GAZE,
    Player,
    director,
    version: 2,
    load,
    info,
    sample,
    blend: blendPoses,
    look,
    gazeMove,
    draw,
    ease: { out: easeOut, io: easeIO, smooth },
  };
})();
