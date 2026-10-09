import { MGEO, elevMC } from './survey/monaco.js';
import { bumpU } from './shared.js';

const monaco =
  { id:"monaco", name:"Monaco", loc:"Circuit de Monaco", laps:[4,8,14], len:3337, width:12.2, night:false, sun:2.72, sunH:0.55, rain:0.10,
    facade:"stone",
    pal:{ skyA:"#3F9BDD", skyB:"#CFE4F2", ground:"#D6CCB8", grass:"#86A05F", road:"#4A4E55", kerbA:"#D8352A", kerbB:"#EDEDED",
          wall:"#D9D4C8", line:"#E9E9E9", accent:"#1E6FA8", water:"#2E86C8" },
    barrier:"wall", runoff:1.2,
    // the real circuit: the surveyed OpenStreetMap centreline, built around Port
    // Hercule with the terrain, coastline and buildings that go with it
    world:"monaco", zoomK:1.45, path:() => MGEO.pathRaw(), smooth:2,
    bridges:[ { u:0.100 }, { u:0.690 }, { u:0.930 } ],
    camber:u => 0.045 * bumpU(u, 0.262, 0.016),
    // the pit lane, from the mapped "Voie des stands": off at Antony Noghes, on
    // the harbour side, and back out after Sainte-Devote
    pit:{ side:1, in:0.894, out:0.079, box:0.968, limit:60, limitLen:340 },               // 60 km/h down a short lane
    // Boulevard Louis II, where OpenStreetMap tags it as tunnel
    tunnel:[0.425, 0.563],
    /* Run-off, corner by corner. Monaco is walls almost everywhere; these are the
       places with a real escape. u comes from the surveyed lap. For a right-hander
       the outside is l, for a left-hander r. */
    runoffZones:[
      { a:0.042, b:0.072, l:11, r:1.2, n:"Sainte-Devote, straight on" },
      { a:0.318, b:0.345, l:10, r:1.2, n:"Mirabeau Haute, straight on" },
      { a:0.606, b:0.636, l:1.2, r:20, n:"the Nouvelle Chicane escape road" },
      { a:0.857, b:0.874, l:5,  r:1.2, n:"Rascasse, a short escape" },
      { a:0.252, b:0.266, l:1.2, r:4, n:"Casino, a little room on the exit" },
      { a:0.700, b:0.830, l:0.5, r:0.5, n:"Tabac and the Piscine: the wall is right there" },
    ],
    grade:{ exposure:1.02, strength:0.10, radius:0.40, threshold:1.6, knee:0.3 },
    zScale:1.0,
    // metres above sea level, anchored to where the corners really are on the
    // surveyed lap: flat by the harbour, 10-12 % up Beau Rivage, the crest in
    // Place du Casino, down through Mirabeau and the hairpin to Portier, a gentle
    // fall through the tunnel, and the lowest point just before La Rascasse
    elev:(pts => { const f = elevMC(pts); return u => f(u); })([
      [0.000, 3.5], [0.040, 3.8], [0.060, 4.5], [0.075, 6.5], [0.090, 9.5], [0.110, 15.0], [0.130, 22.5],
      [0.150, 29.5], [0.170, 34.5], [0.196, 38.0], [0.217, 40.5], [0.245, 43.0], [0.262, 44.0], [0.278, 43.0],
      [0.310, 39.5], [0.335, 36.0], [0.355, 32.0], [0.373, 28.0], [0.399, 19.0], [0.421, 11.5], [0.432, 9.2],
      [0.500, 7.0], [0.563, 5.2], [0.627, 4.0], [0.712, 3.2], [0.760, 2.6], [0.815, 2.2], [0.855, 2.0],
      [0.872, 2.1], [0.893, 2.8], [0.950, 3.3], [1.000, 3.5] ]),
    // the old stylised layout, kept for reference; the surveyed path above is what is built
    layout:"S147 R88/23 S69 L18/186 S214 L74/51 S47 R69/28 S90 R16/75 S55 R99/14 S46 L169/8 S28 R46/19 S20 R105/16 S50 R98/163 S215 L51/16 R50/12 S189 L93/33 S72 L40/21 R28/24 S68 R53/18 L78/11 S42 R143/10 S82 R74/20 S93",
    // the 2D fallback still paints these relative to the track
    land:[ {t:"blob", n:4, side:"out", near:430, far:760, size:[300,430], col:"#2E86C8", clear:true, drop:6},
           {t:"blob", n:3, side:"out", near:250, far:430, size:[150,220], col:"#3EA0D8", clear:true, drop:5, a:0.50, b:0.84},
           {t:"parcel", n:130, side:"in", near:16, far:90, size:[8,22], col:"#D8C8AE"},
           {t:"parcel", n:100, side:"in", near:22, far:130, size:[9,24], col:"#C4A98C"},
           {t:"parcel", n:54, side:"in", near:60, far:280, size:[14,36], col:"#CFC3AC"},
           {t:"blob", n:56, side:"in", near:24, far:150, size:[8,22], col:"#6E8C4E"} ],
    scene:[ {t:"lm", only2d:true, k:"casino", n:1, a:0.262, b:0.262, side:"in", off:30, h:[52,52], col:"#EADFC8"},
            {t:"lm", only2d:true, k:"hotelparis", n:1, a:0.245, b:0.245, side:"out", off:34, h:[46,46], col:"#F0E7D2"},
            {t:"lm", only2d:true, k:"fairmont", n:1, a:0.40, b:0.40, side:"out", off:46, h:[44,44], col:"#E8DCC4"},
            {t:"lm", only2d:true, k:"palace", n:1, a:0.92, b:0.92, side:"out", off:250, h:[70,70], col:"#E9D7B8"},
            {t:"lm", only2d:true, k:"piscine", n:1, a:0.79, b:0.79, side:"in", off:30, h:[30,30], col:"#2E8CD0"},
            {t:"lm", only2d:true, k:"rascasse", n:1, a:0.87, b:0.87, side:"in", off:22, h:[14,14], col:"#E2C8A6"},
            {t:"yacht", only2d:true, n:12, a:0.54, b:0.8, side:"out", off:46, h:[7,13], col:"#F2F4F6"},
            {t:"yacht", only2d:true, n:6, a:0.6, b:0.78, side:"out", off:78, h:[9,16], col:"#F6F7F8"},
            {t:"hotel", only2d:true, n:22, a:0.06, b:0.42, side:"in", off:36, h:[18,40], col:"#E4D9C6"},
            {t:"hotel", only2d:true, n:14, a:0.06, b:0.4, side:"out", off:40, h:[16,34], col:"#DCCBB2"},
            {t:"hotel", only2d:true, n:16, a:0.55, b:0.95, side:"in", off:38, h:[14,30], col:"#D8C8AE"},
            {t:"hotel", only2d:true, n:8, a:0.86, b:1, side:"out", off:44, h:[16,28], col:"#DCCBB2"},
            {t:"grandstand", n:1, a:0.97, b:0.97, side:"out", off:24, h:[12,12], col:"#B9BFC6", wid:120},
            {t:"grandstand", n:1, a:0.02, b:0.02, side:"out", off:24, h:[11,11], col:"#B9BFC6", wid:90},
            {t:"grandstand", n:1, a:0.62, b:0.62, side:"out", off:24, h:[10,10], col:"#B9BFC6", wid:70},
            {t:"grandstand", n:1, a:0.72, b:0.72, side:"out", off:24, h:[10,10], col:"#B9BFC6", wid:60},
            {t:"palm", n:26, a:0.53, b:0.95, side:"out", off:16, h:[9,14], col:"#2E7D4F"},
            {t:"palm", n:10, a:0, b:0.06, side:"out", off:15, h:[9,13], col:"#2E7D4F"},
            {t:"billboard", n:10, a:0, b:1, side:-1, off:14, h:[8,11], col:"#1E6FA8"},
            {t:"marshal", n:16, a:0, b:1, side:1, off:13, h:[3,3], col:"#D8DCE0"},
            {t:"arch", n:2, a:0.03, b:0.6, side:0, off:0, h:[8,8], col:"#D8352A"} ] };

export default monaco;
