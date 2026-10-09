import { ZGEO } from './survey/zandvoort.js';

const zandvoort =
  { id:"zandvoort", name:"Zandvoort", zoomK:1.3, loc:"Circuit Zandvoort", laps:[4,9,16], len:4259, width:13.4, night:false, sun:1.5, rain:0.35,
    facade:"brick",
    pal:{ skyA:"#5FA2D8", skyB:"#E2ECF0", ground:"#D6C79E", grass:"#8C9A5E", road:"#4F5258", kerbA:"#D8352A", kerbB:"#EDEDED",
          wall:"#BCC2C8", line:"#EFEFEF", accent:"#FF7A00", water:"#3B7FA8" },
    barrier:"armco", runoff:6,
    // the real circuit: the surveyed OpenStreetMap lap, with the dunes, the beach,
    // the sea and the town built from the same survey (see ZGEO for the one liberty)
    world:"zandvoort", survey:true, path:() => ZGEO.pathRaw(), smooth:2,
    // the mapped Pitstraat: in on the main straight after Arie Luyendyk, along the
    // inside (east) of the straight and round the inside of Tarzan, out before Gerlach
    pit:{ side:1, in:0.921, out:0.1065, box:0.006, width:7.6, gap:4, limit:60 },            // 60 km/h, as at Monaco
    elev:u => ZGEO.elev(u),
    /* Hugenholtz and Arie Luyendyk are banked about 18-19 degrees, progressively:
       about 4 degrees at the inside, 0.335 (18.5 degrees) at the outside edge, rising
       about 3.5 m across the track and carrying on up to the wall. Tarzan has a mild camber. */
    banking:{ g0:0.05, g1:0.335, p:0.45, apron:0, speedK:0.75,
      corners:[ { name:"Hugenholtzbocht", a:0.150, b:0.215, ramp:42 },
                { name:"Arie Luyendykbocht", a:0.820, b:0.905, ramp:46 },
                { name:"Tarzanbocht", kind:"camber", g:0.045, a:0.045, b:0.100, ramp:30 } ] },
    /* Run-off, corner by corner. Right-handers are + on this lap, so the outside
       of a right is l and of a left is r. The banked corners have the SAFER
       barrier right beside the track (lb/rb:"safer"). Confidence per corner is
       my own and noted on each. Most of it is gravel: the circuit says it has
       more than 2,500 m of it. */
    runoffSurf:"grass", runoffAstro:0,
    runoffZones:[
      { a:0.040, b:0.095, l:30, ls:"mix", lt:4, r:4, rs:"grass", n:"Tarzan: a big gravel trap outside (fairly sure)" },
      { a:0.118, b:0.152, l:14, ls:"gravel", n:"Gerlach: gravel outside (not sure)" },
      { a:0.152, b:0.205, r:1.6, rs:"asphalt", rb:"safer", l:4, ls:"grass", n:"Hugenholtz, banked: SAFER wall right at the edge (sure)" },
      { a:0.250, b:0.300, l:12, ls:"gravel", r:10, rs:"gravel", n:"Hunserug: gravel both sides (a guess)" },
      { a:0.340, b:0.410, l:16, ls:"gravel", n:"Rob Slotemaker: gravel outside (not sure)" },
      { a:0.430, b:0.478, l:22, ls:"gravel", n:"Scheivlak: a long gravel trap outside (fairly sure)" },
      { a:0.490, b:0.528, l:16, ls:"gravel", n:"Mastersbocht: gravel (not sure)" },
      { a:0.552, b:0.592, r:14, rs:"gravel", n:"Turns 9 and 10: gravel (a guess)" },
      { a:0.690, b:0.745, l:12, ls:"mix", lt:5, r:10, rs:"mix", rt:5, n:"Hans Ernst chicane: tarmac then gravel (not sure)" },
      { a:0.782, b:0.818, l:12, ls:"gravel", n:"Turn 13: gravel (a guess)" },
      { a:0.822, b:0.902, l:1.6, ls:"asphalt", lb:"safer", r:4, rs:"grass", n:"Arie Luyendyk, banked: SAFER wall right at the edge (sure)" },
    ],
    // Zandvoort: built into the North Sea dunes — bare sand, marram grass, the
    // beach and the water beyond them
    land:[ {t:"blob", n:6, side:"out", near:640, far:980, size:[220,320], col:"#3E6E92", clear:true, drop:5, a:0.3, b:0.7},
           {t:"blob", n:4, side:"out", near:430, far:600, size:[140,200], col:"#4A7C9E", clear:true, drop:4, a:0.36, b:0.64},
           {t:"blob", n:7, side:"out", near:300, far:420, size:[80,140], col:"#E2D6B4", clear:true, drop:2, a:0.36, b:0.64},
           {t:"blob", n:104, near:16, far:120, size:[9,26], col:"#D9CDA6"},
           {t:"blob", n:80, near:24, far:160, size:[11,30], col:"#C9BC94"},
           {t:"blob", n:64, near:18, far:128, size:[8,22], col:"#A8A873"},
           {t:"blob", n:48, near:32, far:205, size:[13,36], col:"#8E9A62"},
           {t:"blob", n:30, near:70, far:360, size:[26,72], col:"#BFB489"},
           {t:"blob", n:20, near:140, far:560, size:[55,140], col:"#CFC299"} ],
    // the old stylised layout, kept for reference; the surveyed path above is what is built
    layout:"S336 R119/24 S168 L88/48 S79 R112/27 S280 R36/99 S252 R81/96 S132 R84/54 S72 L31/77 S84 L41/24 R67/28 S96 L56/38 S185 R145/48 S216",
    scene:[ {only2d:true, t:"lm", k:"pitbuilding", n:1, a:0.985, b:0.985, side:-1, off:42, h:[24,24], col:"#D8802E"},
            {only2d:true, t:"grandstand", n:1, a:0.14, b:0.14, side:"out", off:24, h:[22,22], col:"#D8802E", wid:150},
            {only2d:true, t:"grandstand", n:1, a:0.98, b:0.98, side:"out", off:24, h:[16,16], col:"#D8802E", wid:260},
            {only2d:true, t:"grandstand", n:1, a:0.05, b:0.05, side:"out", off:24, h:[14,14], col:"#D8802E", wid:120},
            {only2d:true, t:"grandstand", n:1, a:0.52, b:0.52, side:"out", off:24, h:[12,12], col:"#D8802E", wid:80},
            {only2d:true, t:"grandstand", n:1, a:0.87, b:0.87, side:"out", off:24, h:[13,13], col:"#D8802E", wid:90},
            {only2d:true, t:"lm", k:"chalet", n:16, a:0, b:0.2, side:"in", off:140, h:[10,10], col:"#9A5A44"},
            {only2d:true, t:"lm", k:"chalet", n:10, a:0.85, b:1, side:"in", off:150, h:[10,10], col:"#9A5A44"},
            {only2d:true, t:"dune", n:36, a:0, b:1, side:1, off:46, h:[6,13], col:"#CDBE94"},
            {only2d:true, t:"dune", n:30, a:0, b:1, side:-1, off:48, h:[5,12], col:"#C4B489"},
            {only2d:true, t:"dune", n:20, a:0, b:1, side:0, off:96, h:[8,17], col:"#D3C59C"},
            {only2d:true, t:"billboard", n:14, a:0, b:1, side:-1, off:22, h:[10,14], col:"#FF7A00"},
            {only2d:true, t:"arch", n:2, a:0, b:0.5, side:0, off:0, h:[9,9], col:"#FF7A00"},
            {only2d:true, t:"marshal", n:12, a:0, b:1, side:1, off:20, h:[3,3], col:"#D8DCE0"} ] };

export default zandvoort;
