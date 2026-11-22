// ---------------------------------------------------------------------------
// Stage layouts. Coordinates are in the 1920x1080 logical space.
//   shops[]  : building facades along the back (drawn by SG.Backdrop).
//              hatchX = centre of the serving hatch (null = decorative shop).
//              roofY  = screen y of the roof eave (gulls can perch along it).
//   bay      : x-range where the back of the quay opens onto the bay.
//   props[]  : physical props on the promenade (drawn by SG.Props).
// ---------------------------------------------------------------------------
(function (SG) {
  'use strict';

  SG.STAGES = {
    oban: {
      id: 'oban',
      name: 'Oban Bay',
      tagline: 'Seafood capital of the gulls',
      landmark: 'mccaig',
      skyTop: '#5fb8f0', skyBottom: '#d8f1ff',
      waterColor: '#2a9fb8',
      bay: { x0: 1440, x1: 1920 },
      ferrySide: 'right',
      shops: [
        { type: 'chippy',   style: 'building', x0: 20,   x1: 380,  hatchX: 200,  roofY: 268, color: '#5ab8de', trim: '#ffffff', label: 'THE SALTY HADDIE', sub: 'FISH & CHIPS' },
        { type: 'bakery',   style: 'building', x0: 390,  x1: 640,  hatchX: 515,  roofY: 300, color: '#ffd166', trim: '#ffffff', label: 'PIECE O’ CAKE', sub: 'BAKERS' },
        { type: 'pub',      style: 'building', x0: 650,  x1: 900,  hatchX: null, roofY: 250, color: '#3d5a80', trim: '#f1d6a8', label: 'THE CORMORANT', sub: 'BAR' },
        { type: 'icecream', style: 'building', x0: 910,  x1: 1180, hatchX: 1045, roofY: 286, color: '#ff9ebb', trim: '#ffffff', label: 'DOLCE VITA', sub: 'ICES' },
        { type: 'cafe',     style: 'building', x0: 1190, x1: 1440, hatchX: 1315, roofY: 262, color: '#9ee6b8', trim: '#ffffff', label: 'THE WEE CAFÉ', sub: 'PIECES & TEAS' },
        { type: 'seafood',  style: 'hut',      x0: 1520, x1: 1780, hatchX: 1650, roofY: 372, color: '#3fae5a', trim: '#ffffff', label: 'CREEL & DEAL', sub: 'SEAFOOD' },
      ],
      props: [
        { type: 'bin', x: 390, y: 615 },
        { type: 'bin', x: 1185, y: 612 },
        { type: 'bin', x: 860, y: 868 },
        { type: 'bin', x: 1470, y: 640 },
        { type: 'bench', x: 300, y: 832 },
        { type: 'bench', x: 640, y: 760 },
        { type: 'bench', x: 1110, y: 830 },
        { type: 'picnic', x: 1590, y: 735 },
        { type: 'picnic', x: 1810, y: 840 },
        { type: 'lamp', x: 120, y: 890 },
        { type: 'lamp', x: 560, y: 890 },
        { type: 'lamp', x: 1000, y: 890 },
        { type: 'lamp', x: 1440, y: 890 },
        { type: 'lamp', x: 1880, y: 890 },
        { type: 'creels', x: 1855, y: 625 },
        { type: 'planter', x: 790, y: 612 },
        { type: 'sign', x: 1350, y: 880, text: 'PLEASE DO NOT FEED THE GULLS' },
        { type: 'bollard', x: 1500, y: 575 }, { type: 'bollard', x: 1820, y: 575 },
      ],
    },

    largs: {
      id: 'largs',
      name: 'Largs Prom',
      tagline: 'Where the Vikings came for the chips',
      landmark: 'pencil',
      skyTop: '#7cc6f2', skyBottom: '#ffe9cf',
      waterColor: '#2f97c4',
      bay: { x0: 0, x1: 450 },
      ferrySide: 'left',
      shops: [
        { type: 'chippy',   style: 'building', x0: 460,  x1: 750,  hatchX: 605,  roofY: 280, color: '#e85d5d', trim: '#fff3d6', label: 'VIKING CHIPPY', sub: 'FISH SUPPERS' },
        { type: 'icecream', style: 'deco',     x0: 760,  x1: 1120, hatchX: 940,  roofY: 300, color: '#fff1d0', trim: '#2bb3a6', label: 'VALENTE’S', sub: 'ICE CREAM PARLOUR' },
        { type: 'arcade',   style: 'building', x0: 1130, x1: 1400, hatchX: null, roofY: 290, color: '#7b5cd6', trim: '#ffd23f', label: 'AMUSEMENTS', sub: '2p FALLS' },
        { type: 'bakery',   style: 'building', x0: 1410, x1: 1650, hatchX: 1530, roofY: 258, color: '#ffb35c', trim: '#ffffff', label: 'PIER BAKERY', sub: 'PIES & ROLLS' },
        { type: 'cafe',     style: 'building', x0: 1660, x1: 1910, hatchX: 1785, roofY: 276, color: '#6fd3e8', trim: '#ffffff', label: 'SEASHELL CAFÉ', sub: 'PIECES' },
      ],
      props: [
        { type: 'bin', x: 455, y: 640 },
        { type: 'bin', x: 1125, y: 612 },
        { type: 'bin', x: 1655, y: 612 },
        { type: 'bin', x: 980, y: 868 },
        { type: 'bench', x: 240, y: 800 },
        { type: 'bench', x: 760, y: 836 },
        { type: 'bench', x: 1330, y: 760 },
        { type: 'bench', x: 1690, y: 840 },
        { type: 'lamp', x: 60, y: 890 },
        { type: 'lamp', x: 520, y: 890 },
        { type: 'lamp', x: 980, y: 890 },
        { type: 'lamp', x: 1440, y: 890 },
        { type: 'lamp', x: 1880, y: 890 },
        { type: 'planter', x: 300, y: 640 },
        { type: 'planter', x: 1270, y: 875 },
        { type: 'longship', x: 150, y: 640 },
        { type: 'sign', x: 680, y: 872, text: 'GULLS WILL STEAL YOUR FOOD' },
        { type: 'bollard', x: 80, y: 575 }, { type: 'bollard', x: 380, y: 575 },
      ],
    },
  };

  SG.STAGE_ORDER = ['oban', 'largs'];
})(window.SG);
