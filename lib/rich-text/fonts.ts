import {
  Bebas_Neue,
  Caveat,
  DM_Sans,
  Hind_Siliguri,
  Lora,
  Merriweather,
  Montserrat,
  Playfair_Display,
  Poppins,
  Source_Serif_4,
  Space_Grotesk,
  Work_Sans,
} from "next/font/google";

/**
 * The type families a seller may use in a description.
 *
 * A closed catalogue rather than a free-text font name, for a reason that is
 * about buyers rather than tidiness: a name typed into a box either loads an
 * arbitrary web font on every product view — a cost every visitor pays for one
 * seller's preference — or silently falls back to something the seller never
 * chose and cannot see from their own machine, where the font is installed.
 *
 * Every entry here is declared with `preload: false`. Next still emits the
 * @font-face rules, but the browser only fetches a file when something on the
 * page actually renders in that family, so a catalogue of fifteen costs a page
 * that uses none of them nothing at all.
 */

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
  preload: false,
});

const workSans = Work_Sans({
  subsets: ["latin"],
  variable: "--font-work-sans",
  display: "swap",
  preload: false,
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-poppins",
  display: "swap",
  preload: false,
});

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
  preload: false,
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
  preload: false,
});

/**
 * Bengali, because this marketplace sells in Bangladesh.
 *
 * Without a face that covers the script, a Bengali description falls back to
 * whatever the reader's device happens to have, which on many phones is a
 * mismatched weight beside the Latin text around it.
 */
const hindSiliguri = Hind_Siliguri({
  subsets: ["bengali", "latin"],
  weight: ["400", "600"],
  variable: "--font-hind-siliguri",
  display: "swap",
  preload: false,
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
  preload: false,
});

const merriweather = Merriweather({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-merriweather",
  display: "swap",
  preload: false,
});

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
  display: "swap",
  preload: false,
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
  preload: false,
});

const bebas = Bebas_Neue({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-bebas",
  display: "swap",
  preload: false,
});

const caveat = Caveat({
  subsets: ["latin"],
  variable: "--font-caveat",
  display: "swap",
  preload: false,
});

/** Applied to <html>, so every family is available to the whole tree. */
export const FONT_VARIABLE_CLASSES = [
  dmSans.variable,
  workSans.variable,
  poppins.variable,
  montserrat.variable,
  spaceGrotesk.variable,
  hindSiliguri.variable,
  playfair.variable,
  merriweather.variable,
  lora.variable,
  sourceSerif.variable,
  bebas.variable,
  caveat.variable,
].join(" ");
