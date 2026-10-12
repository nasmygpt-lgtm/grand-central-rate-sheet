"use strict";

const el = (id) => document.getElementById(id);
let lastData = null;
let lastNonRefundable = false;

/* =========================================================================
   PARSER — turns pasted booking text into structured data
   ========================================================================= */
const MONTHS = {
  jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June",
  jul: "July", aug: "August", sep: "September", sept: "September", oct: "October",
  nov: "November", dec: "December",
};

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// "14-Oct" / "14 Oct" / "14/10" -> "14th October 2025"
function formatDate(raw, year) {
  if (!raw) return "";
  raw = raw.trim();
  let m = raw.match(/^(\d{1,2})[\s\-\/]([A-Za-z]{3,9})(?:[\s\-\/](\d{2,4}))?$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()] || m[2];
    const yr = m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : year;
    return `${ordinal(day)} ${mon} ${yr}`;
  }
  m = raw.match(/^(\d{1,2})[\-\/](\d{1,2})(?:[\-\/](\d{2,4}))?$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const monNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const mon = monNames[parseInt(m[2], 10) - 1] || "";
    const yr = m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : year;
    return `${ordinal(day)} ${mon} ${yr}`;
  }
  return raw; // leave as-is if unrecognised
}

// Date must be: day + month-name  (or day/month numeric with a slash/dash). We require a
// month NAME or a dd-mm style so plain "4" (as in "4 Rooms") is never seen as a date.
// day + month-name, with an OPTIONAL year that must be a full 4-digit year, or a
// 2-4 digit year joined by a dash/slash (NOT a space/tab — that would swallow the next column).
const DATE_RE = /\b(\d{1,2}[\s\-\/](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*(?:[\-\/]\d{2,4}|\s+\d{4})?)\b/gi;
function findDates(s) { return s.match(DATE_RE) || []; }
// extract day-of-month number from a formatted date like "14th October 2025"
function parseDay(formatted) {
  const m = String(formatted || "").match(/^(\d{1,2})/);
  return m ? parseInt(m[1], 10) : null;
}
const COST_RE = /(\d+(?:\.\d+)?)\s*[xX]\s*(\d+)\s*=\s*(\d+(?:\.\d+)?)/; // 200 x 4 = 800
const ADULT_RE = /(\d+)\s*(?:Adult|Adults|Pax|Person|Persons|Guest|Guests)/i;
const NIGHTS_RE = /\b(\d+)\s*(?:Night|Nights|N)\b/i;
const MEAL_RE = /\b(BB|HB|FB|RO|AI|CP|MAP|AP|EP)\b/i;
const EXTRA_BED_RE = /extra\s*bed/i;
const CURRENT_YEAR = String(new Date().getFullYear());

// A room row contains TWO dates (check-in + check-out). But depending on how the booking
// was copied, the two dates may sit on the SAME line (columnar paste) or on SEPARATE lines
// (copied from an HTML/email table, where each cell becomes its own line).
// Strategy: scan the whole text left-to-right; every time we see a date that is a *check-in*
// (i.e. the start of a new date-pair) we open a new room. The pairing rule: dates come in
// order, so date #1 = check-in, date #2 = check-out of the SAME room, date #3 = next room's
// check-in, and so on. Everything between a room's check-in and the next room's check-in
// (names, room type, counts, cost) belongs to that room.

// Main entry: detect which kind of booking document this is and route to the right parser.
function parseBooking(text, forcedYear) {
  // "PMS form" screenshot (e.g. GCH reservation screen). OCR mangles this heavily, so detect
  // it loosely: any mix of these PMS-specific tokens (allowing OCR typos like "Arrval",
  // "No.ofRms", "RoomType", "RTC", "Rate Code").
  const pmsHits = [
    /\bReservation\s+\d{2,}/i,
    /\bArr?i?v?al\b/i,           // Arrival / Arrval
    /\bDeparture\b/i,
    /No\.?\s*of\s*Rms?/i,
    /Room\s*Type/i,
    /\bRTC\b/i,
    /Rate\s*Code/i,
    /Res\.?\s*Type/i,
  ].filter((re) => re.test(text)).length;
  if (pmsHits >= 2) return parsePms(text, forcedYear);

  // "Group colon-labelled" format (e.g. Bedouin Trips): BOOKING REF :, HOTEL :, NAME :,
  // CHECK IN :, CHECK OUT :, Number of rooms :, Rate :, TD FEE :.
  const looksGroupLabeled = /Number\s*of\s*rooms?\s*:/i.test(text) &&
    /CHECK\s*IN\s*:/i.test(text) && /\bRate\b\s*:/i.test(text);
  if (looksGroupLabeled) return parseGroupLabeled(text, forcedYear);

  // "Grouped" format: guests listed under room-type headings (DOUBLE ROOM / TRIPLE ROOM)
  // with a shared date range and a combined rate line.
  const looksGrouped = /\b(DOUBLE|TRIPLE|TWIN|SINGLE|QUAD)\s*ROOM\s*:?/i.test(text) &&
    /GUEST\s*NAMES?|RATE\s*:/i.test(text);
  if (looksGrouped) return parseGrouped(text, forcedYear);

  // "Prose" formats (e.g. Dahr Tours) use free-text labels like "Lead Pax Name :",
  // "Date : Check in … check out …", "Room : … PER ROOM PER NIGHT".
  const looksProse = /Lead\s*Pax|Total\s*Pax|PER\s*ROOM\s*PER\s*NIGHT|Date\s*:\s*Check\s*in/i.test(text);
  if (looksProse) return parseProse(text, forcedYear);

  // "Labeled" formats (e.g. Darina Holidays) use "Check In:" / "Room Type:" / "Names:" labels
  // and a "Rates Breakdown" / "Sum Total" block instead of a per-guest row table.
  const looksLabeled = /Check\s*In\s*:/i.test(text) &&
    (/Room\s*Type\s*:/i.test(text) || /Sum\s*Total\s*:/i.test(text) || /Rates?\s*Breakdown/i.test(text));
  if (looksLabeled) return parseLabeled(text, forcedYear);

  return parseTabular(text, forcedYear);
}

/* ---- Format 6: PMS reservation screen (GCH-style screenshot) ----------------
   Title: "GCH - Reservation 64179 RESERVED"
   Name: MANGAT | First Name: SARPREET KAUR | Agent: Ghai Holidays
   Arrival: 13/10/26 | Departure: 19/10/26 | Nights: 6
   Adults 1 Child 0 | No. of Rms. 1 | Room Type DDN | Rate Code TA-BB
   Rate 200.00 | Total 215.00
---------------------------------------------------------------------------- */
function parsePms(text, forcedYear) {
  const data = { confNumber: "", company: "", rooms: [] };
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = (forcedYear && String(forcedYear).trim()) || (yearMatch ? yearMatch[1] : CURRENT_YEAR);
  const grab = (re) => { const m = text.match(re); return m ? m[1].trim() : ""; };

  // Confirmation: "Reservation 64179"
  const conf = grab(/Reservation\s+(\d{3,})/i);
  if (conf) data.confNumber = conf;

  // Company / Agent
  const agent = grab(/\bAgent\b\s*:?\s*([A-Za-z][A-Za-z0-9 &.'-]{2,40})/i);
  if (agent) data.company = agent.replace(/\s{2,}/g, " ").trim();

  // Guest name: "Name MANGAT" (surname) + "First Name SARPREET KAUR".
  // OCR often puts other labels after the value on the same line, so cut the value at the
  // next known label keyword, and extract First Name FIRST (so "Name" doesn't grab it).
  const LABELS = "Phone|Agent|Member|Company|Group|Source|Title|Country|VIP|Language|First\\s*Name|Res\\.?\\s*Type|Market";
  const cutAtLabel = (s) => (s || "").split(new RegExp(`\\s+(?:${LABELS})\\b`, "i"))[0].replace(/\s{2,}/g, " ").trim();

  const firstName = cutAtLabel(grab(/First\s*Name\s+([A-Za-z][A-Za-z'’ .-]{1,40})/i));
  // For surname, match "Name" that is NOT preceded by "First " and stop before the next label.
  let surname = "";
  const nameMatch = text.match(/(?:^|[^A-Za-z])Name\s+([A-Za-z][A-Za-z'’ .-]{1,40})/i);
  if (nameMatch) surname = cutAtLabel(nameMatch[1]);

  let guest = "";
  if (firstName && surname) guest = `${firstName} ${surname}`;
  else guest = (firstName || surname || "").trim();

  // Dates — OCR may give "13/10/26" OR a bracketed run like "[191025]" (ddmmyy, slashes lost).
  const monNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const fmt = (day, mon, yr) => `${ordinal(day)} ${monNames[mon - 1] || ""} ${yr.length === 2 ? "20" + yr : yr}`;
  const parseAnyDate = (s) => {
    if (!s) return "";
    let m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);     // 13/10/26
    if (m) return fmt(+m[1], +m[2], m[3]);
    m = s.match(/\b(\d{2})(\d{2})(\d{2})\b/);                          // 191025 -> 19/10/25
    if (m) return fmt(+m[1], +m[2], m[3]);
    return "";
  };
  // Grab the chunk right after the label (through to the next label), then pull a date from it.
  const afterLabel = (labelRe) => {
    const m = text.match(labelRe);
    return m ? text.slice(m.index, m.index + 40) : "";
  };
  const checkIn = parseAnyDate(afterLabel(/Arr?i?v?al/i));
  const checkOut = parseAnyDate(afterLabel(/Departure/i));

  // Nights — tolerate "[5__|" junk; take the first digit group after "Nights".
  let nights = parseInt((afterLabel(/Nights?/i).match(/Nights?\D{0,4}(\d+)/i) || [])[1] || "0", 10);
  if (!nights) { const a = parseDay(checkIn), b = parseDay(checkOut); if (a != null && b != null && b > a) nights = b - a; }

  // Occupancy — tolerate OCR noise ("dus [1]" for Adults, "chido" for Child)
  const adults = parseInt((text.match(/(?:Adults?|dus)\D{0,4}(\d+)/i) || [])[1] || "1", 10);
  const children = parseInt((text.match(/(?:Child(?:ren)?|chi\w*)\D{0,4}(\d+)/i) || [])[1] || "0", 10);
  const roomCount = parseInt((text.match(/No\.?\s*of\s*Rms?\.?\D{0,4}(\d+)/i) || [])[1] || "1", 10);

  // Room type: default is always Deluxe Room (per hotel standard). OCR of the room-type code
  // on this screen is unreliable, so we don't try to parse it — just use the default.
  const roomType = "Deluxe Room";

  // Meal plan from Rate Code "TA-BB" / "RO" etc.
  let meal = "";
  const rateCode = grab(/Rate\s*Code\s*:?\s*([A-Z0-9\-]+)/i);
  const mealM = (rateCode || text).match(/\b(BB|HB|FB|RO|AI|CP|MAP|AP|EP)\b/i);
  if (mealM) meal = mealM[1].toUpperCase();

  // Rate and Total. The "Total" here is the per-night figure INCLUDING TD (Tourism Dirham).
  // e.g. Rate 200 + TD 15 = Total 215. Capture the difference as the TD per night.
  const rate = parseFloat((grab(/\bRate\s*:?\s*([\d,]+(?:\.\d+)?)/i) || "0").replace(/,/g, ""));
  const total = parseFloat((grab(/\bTotal\s*:?\s*([\d,]+(?:\.\d+)?)/i) || "0").replace(/,/g, ""));
  let td = 0;
  if (total && rate && total > rate) td = +(total - rate).toFixed(2);

  for (let i = 0; i < (roomCount || 1); i++) {
    data.rooms.push({
      guests: i === 0 && guest ? [guest.toUpperCase()] : [],
      checkIn, checkOut, nights: nights || 1,
      roomType, meal: meal || "BB",
      adults: adults || 1, children,
      rate, extra: 0, td,          // TD (e.g. 15) shown in the rate breakdown
    });
  }
  return data;
}

/* ---- Format 5: GROUP colon-labelled (Bedouin Trips-style) -------------------
   BOOKING REF : BTT# 4119911 | NAME : Mr. NAHAS GROUP X 32
   CHECK IN : 21 DEC 2026 | CHECK OUT : 25 DEC 2026
   Number of rooms : 17 rooms | Rate : AED 260 + TD | TD FEE : Bill to ...
   Rule: "+ TD" (Tourism Dirham) adds AED 15 per room PER NIGHT.
---------------------------------------------------------------------------- */
const TD_PER_NIGHT = 15;
function parseGroupLabeled(text, forcedYear) {
  const data = { confNumber: "", company: "", rooms: [] };
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = (forcedYear && String(forcedYear).trim()) || (yearMatch ? yearMatch[1] : CURRENT_YEAR);
  const grab = (re) => { const m = text.match(re); return m ? m[1].trim() : ""; };

  // Company
  const greet = text.match(/(?:Greetings?|Regards?)\s+from\s+(.+)/i);
  if (greet) data.company = greet[1].replace(/[!*:,.]+\s*$/g, "").trim();

  // Booking ref / confirmation (e.g. "BTT# 4119911")
  const ref = grab(/BOOKING\s*REF\s*:?\s*([^\n\r]+)/i) || grab(/\bRef\.?\s*:?\s*([A-Z0-9#\-\/ ]{4,})/i);
  if (ref) data.confNumber = ref.replace(/\s{2,}/g, " ").trim();

  // Guest / group name: "Mr. NAHAS GROUP X 32"
  let guest = grab(/\bNAME\s*:?\s*([^\n\r]+)/i);
  let paxCount = 0;
  if (guest) {
    const xm = guest.match(/\bX\s*0*(\d+)\b/i); if (xm) paxCount = parseInt(xm[1], 10);
    guest = guest.replace(/\bX\s*\d+\b.*/i, "").replace(/\(.*?\)/g, "").replace(/[-–].*/, "").replace(/\s{2,}/g, " ").trim();
  }

  // Dates: "CHECK IN : 21 DEC 2026" / "CHECK OUT : 25 DEC 2026"
  const ci = grab(/CHECK\s*IN\s*:?\s*([0-9]{1,2}\s*[A-Za-z]{3,9}\s*\d{0,4})/i);
  const co = grab(/CHECK\s*OUT\s*:?\s*([0-9]{1,2}\s*[A-Za-z]{3,9}\s*\d{0,4})/i);
  const normDate = (s) => {
    const m = s.match(/([0-9]{1,2})\s*([A-Za-z]{3,9})\s*(\d{4})?/);
    if (!m) return "";
    return `${ordinal(+m[1])} ${monthName(m[2])} ${m[3] || year}`;
  };
  const checkIn = ci ? normDate(ci) : "";
  const checkOut = co ? normDate(co) : "";
  let nights = 0;
  { const a = parseDay(checkIn), b = parseDay(checkOut); if (a != null && b != null && b > a) nights = b - a; }

  // Number of rooms
  const roomCount = parseInt(grab(/Number\s*of\s*rooms?\s*:?\s*0*(\d+)/i) || "1", 10);

  // Room type
  let roomType = "Deluxe Room";
  const rtM = text.match(/(Deluxe Room|Standard Room|Superior Room|Suite|Family Room|Studio)/i);
  if (rtM) roomType = titleCase(rtM[1]);

  // Meal
  let meal = "BB";
  const mealM = text.match(/\b(BB|HB|FB|RO|AI)\b/i); if (mealM) meal = mealM[1].toUpperCase();

  // Rate: "AED 260 + TD"  → base 260, plus TD AED 15/night if "+ TD" / TD mentioned.
  let baseRate = 0, td = 0;
  const rateLine = grab(/\bRate\b\s*:?\s*([^\n\r]+)/i);
  if (rateLine) {
    const rm = rateLine.match(/AED\s*([\d,]+(?:\.\d+)?)/i) || rateLine.match(/([\d,]+(?:\.\d+)?)/);
    if (rm) baseRate = parseFloat(rm[1].replace(/,/g, ""));
  }
  // TD rule: adding AED 15 per night when "+ TD" or a TD line is present.
  if (/\+\s*TD\b/i.test(text) || /\bTD\s*FEE\b/i.test(text) || /\bTD\b/i.test(rateLine || "")) {
    td = TD_PER_NIGHT;
  }

  // Build the rooms (same details for a group). TD is folded into the per-night rate as
  // an "extra" so the existing rate math and totals include it.
  for (let i = 0; i < (roomCount || 1); i++) {
    data.rooms.push({
      guests: i === 0 && guest ? [guest.toUpperCase()] : [],
      checkIn, checkOut, nights: nights || 1,
      roomType, meal,
      adults: paxCount && roomCount ? Math.max(1, Math.round(paxCount / roomCount)) : 2,
      children: 0,
      rate: baseRate, extra: 0,
      td,                       // AED per room per night (Tourism Dirham)
      _group: true, _roomCount: roomCount, _paxCount: paxCount,
    });
  }
  return data;
}

/* ---- Format 4: GROUPED guests under room-type headings ---------------------
   e.g.  12-16 NOVEMBER 2026
         RATE: AED 285 PER ROOM PER NIGHT ... + AED 125 ... FOR EXTRA BED
         GUEST NAMES:
         DOUBLE ROOM
         1).MR. THOMAS ...
         2).MRS. AGNES ...
         TRIPLE ROOM:
         3).RUTH ... 4).NEWTON ... 5).JOSHUA ...
---------------------------------------------------------------------------- */
function parseGrouped(text, forcedYear) {
  const data = { confNumber: "", company: "", rooms: [] };
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = (forcedYear && String(forcedYear).trim()) || (yearMatch ? yearMatch[1] : CURRENT_YEAR);
  const grab = (re) => { const m = text.match(re); return m ? m[1].trim() : ""; };

  // Company (optional greeting)
  const greet = text.match(/(?:Greetings?|Regards?)\s+from\s+(.+)/i);
  if (greet) data.company = greet[1].replace(/[!*:,.]+\s*$/g, "").trim();

  // Confirmation / Ref if present
  const ref = grab(/\bRef\.?\s*:?\s*([A-Z0-9\-\/]{4,})/i);
  if (ref) data.confNumber = ref;

  // Shared date range: "12-16 NOVEMBER 2026" or "12 - 16 Nov 2026"
  let checkIn = "", checkOut = "", nights = 0;
  const range = text.match(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([A-Za-z]{3,9})\s*[-–]?\s*(\d{4})?/);
  if (range) {
    const d1 = +range[1], d2 = +range[2], mon = monthName(range[3]), yr = range[4] || year;
    checkIn = `${ordinal(d1)} ${mon} ${yr}`;
    checkOut = `${ordinal(d2)} ${mon} ${yr}`;
    if (d2 > d1) nights = d2 - d1;
  } else {
    const dates = findDates(text);
    if (dates[0]) checkIn = formatDate(dates[0], year);
    if (dates[1]) checkOut = formatDate(dates[1], year);
    const a = parseDay(checkIn), b = parseDay(checkOut);
    if (a != null && b != null && b > a) nights = b - a;
  }

  // Rates: base "AED 285 PER ROOM PER NIGHT" and extra bed "AED 125 ... FOR EXTRA BED".
  // Capture the extra-bed amount FIRST (the AED value closest before "EXTRA BED"),
  // then take the base rate as the first AED value that isn't the extra-bed one.
  let baseRate = 0, extraBed = 0;
  const extraM = text.match(/AED\s*([\d,]+(?:\.\d+)?)[^\n]{0,30}?(?:FOR\s*)?EXTRA\s*BED/i);
  if (extraM) extraBed = parseFloat(extraM[1].replace(/,/g, ""));
  const baseM = text.match(/AED\s*([\d,]+(?:\.\d+)?)\s*(?:NET\s*)?(?:PER\s*ROOM|\/?\s*PER\s*ROOM|PER\s*NIGHT|P\.?R\.?N)/i)
    || text.match(/RATE\s*:?\s*AED\s*([\d,]+(?:\.\d+)?)/i);
  if (baseM) baseRate = parseFloat(baseM[1].replace(/,/g, ""));
  // Guard: if base accidentally equals the extra-bed figure, fall back to first AED amount.
  if (baseRate && extraBed && baseRate === extraBed) {
    const firstAed = text.match(/AED\s*([\d,]+(?:\.\d+)?)/i);
    if (firstAed) baseRate = parseFloat(firstAed[1].replace(/,/g, ""));
  }

  // Default meal plan
  let meal = "BB";
  const mealM = text.match(/\b(BB|HB|FB|RO|AI)\s*BASIS\b/i) || text.match(/\bBASIS\b.*?\b(BB|HB|FB|RO|AI)\b/i);
  if (mealM) meal = mealM[1].toUpperCase();

  // Split guest section into room groups by room-type headings.
  const guestSection = text.split(/GUEST\s*NAMES?\s*:?/i)[1] || text;
  const headingRe = /\b(SINGLE|DOUBLE|TWIN|TRIPLE|QUAD|FAMILY)\s*ROOM\s*:?/gi;
  const groups = [];
  let match, lastIdx = null, lastType = null;
  const indices = [];
  while ((match = headingRe.exec(guestSection)) !== null) {
    indices.push({ type: match[1].toUpperCase(), start: match.index, end: headingRe.lastIndex });
  }
  for (let i = 0; i < indices.length; i++) {
    const seg = guestSection.slice(indices[i].end, i + 1 < indices.length ? indices[i + 1].start : undefined);
    groups.push({ type: indices[i].type, body: seg });
  }

  const roomCapacity = { SINGLE: 1, DOUBLE: 2, TWIN: 2, TRIPLE: 3, QUAD: 4, FAMILY: 4 };

  // Lines that are clearly NOT guest names (closings / notes) — stop collecting at these.
  const stopRe = /^(waiting|thanks?|thank\s*you|regards?|best|kind|please|note|remarks?|rate\s*:|total|tdf|tourism)/i;

  for (const g of groups) {
    // Extract guest names — only from lines that are numbered or titled (Mr/Mrs/Ms) or
    // plainly a name. Stop as soon as we hit a closing/non-guest line.
    const names = [];
    const lines = g.body.split(/\r?\n/);
    for (let ln of lines) {
      let s = ln.trim();
      if (!s) continue;
      if (stopRe.test(s)) break;                        // reached closing text → stop this group
      const isNumbered = /^\s*\d+\s*[\).\.-]/.test(s);
      const isTitled = /^(MR|MRS|MS|MISS|DR|MASTER)\b/i.test(s.replace(/^\s*\d+\s*[\).\.-]*\s*/, ""));
      s = s.replace(/^\s*\d+\s*[\).\.-]*\s*/, "")       // "1)." / "3)."
           .replace(/\b\d+\s*YRS?\b\.?/gi, "")           // "21YRS"
           .replace(/\(.*?\)/g, "")
           .replace(/[.\s]+$/,"")
           .replace(/\s{2,}/g, " ")
           .trim();
      // Accept only if it was numbered/titled, or a plausible all-letters name (2+ words)
      const plausible = isNumbered || isTitled || /^[A-Za-z][A-Za-z .'-]{3,}$/.test(s);
      if (s && plausible && /[A-Za-z]{2,}/.test(s)) names.push(s.toUpperCase());
    }
    if (!names.length) continue;

    const cap = roomCapacity[g.type] || 2;
    const adults = names.length;             // count all listed as guests
    // Triple/Quad with more guests than a double implies extra bed(s)
    const extra = (g.type === "TRIPLE" || g.type === "QUAD") && extraBed ? extraBed : 0;

    data.rooms.push({
      guests: names,                          // lead = names[0] in render
      checkIn, checkOut, nights: nights || 1,
      roomType: titleCase(g.type + " ROOM"),
      meal, adults, children: 0,
      rate: baseRate, extra,
    });
  }

  // If no groups found but a count line like "01 DBL + 1 TRIPLE ROOM" exists, still create rooms.
  if (!data.rooms.length) {
    data.rooms.push({ guests: [], checkIn, checkOut, nights: nights || 1, roomType: "Deluxe Room", meal, adults: 1, children: 0, rate: baseRate, extra: 0 });
  }
  return data;
}

/* ---- Format 3: PROSE / free-text labels (Dahr Tours-style) ------------------ */
function parseProse(text, forcedYear) {
  const data = { confNumber: "", company: "", rooms: [] };
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = (forcedYear && String(forcedYear).trim()) || (yearMatch ? yearMatch[1] : CURRENT_YEAR);
  const grab = (re) => { const m = text.match(re); return m ? m[1].trim() : ""; };

  // Company
  const greet = text.match(/(?:Greetings?|Regards?)\s+from\s+(.+)/i);
  if (greet) data.company = greet[1].replace(/[!*:,.]+\s*$/g, "").trim();

  // Confirmation / Ref
  const ref = grab(/\bRef\.?\s*:?\s*([A-Z0-9\-\/]{4,})/i);
  if (ref) data.confNumber = ref;

  // Guest: "Lead Pax Name : MS. SURAIYA MAJIDI X 01 PAX - (TANZANIAN)"
  let guest = grab(/Lead\s*Pax\s*Name\s*:?\s*([^\n\r]+)/i) || grab(/(?:Guest|Pax|Name)\s*:?\s*([^\n\r]+)/i);
  if (guest) {
    guest = guest
      .replace(/\bX\s*\d+\s*PAX\b.*/i, "")   // drop "X 01 PAX - (TANZANIAN)"
      .replace(/\(.*?\)/g, "")               // drop "(TANZANIAN)"
      .replace(/[-–].*/, "")                  // drop trailing dash notes
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // Dates — handle several wordings:
  //  "Check in 07 check out 13 October - 2026"
  //  "Check in -NOV 9-14 - 2026"           (month BEFORE the day range)
  //  "Check in 07-Oct check out 13-Oct"
  let checkIn = "", checkOut = "", nights = 0;
  const MON = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";

  // (a) month-first range: "NOV 9-14 - 2026" or "NOVEMBER 9 - 14 2026"
  let dm = text.match(new RegExp(`(?:check\\s*in\\s*[-–]?\\s*)?\\b(${MON})[A-Za-z]*\\s*(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\s*[-–]?\\s*(\\d{4})?`, "i"));
  if (dm) {
    const mon = monthName(dm[1]), d1 = +dm[2], d2 = +dm[3], yr = dm[4] || year;
    checkIn = `${ordinal(d1)} ${mon} ${yr}`;
    checkOut = `${ordinal(d2)} ${mon} ${yr}`;
    if (d2 > d1) nights = d2 - d1;
  }
  // (b) day-first with check in/out: "Check in 07 check out 13 October - 2026"
  if (!checkIn) {
    dm = text.match(/check\s*in\s*([0-9]{1,2})(?:\s*[A-Za-z]{0,9})?\s*(?:to|-|–|check\s*out)\s*([0-9]{1,2})\s*([A-Za-z]{3,9})?\s*[-–]?\s*(\d{4})?/i);
    if (dm) {
      const d1 = +dm[1], d2 = +dm[2], mon = dm[3] || "", yr = dm[4] || year;
      checkIn = mon ? `${ordinal(d1)} ${monthName(mon)} ${yr}` : formatDate(String(d1), yr);
      checkOut = mon ? `${ordinal(d2)} ${monthName(mon)} ${yr}` : formatDate(String(d2), yr);
      if (d2 > d1) nights = d2 - d1;
    }
  }
  // (c) fallback: any two dates in the text
  if (!checkIn) {
    const dates = findDates(text);
    if (dates[0]) checkIn = formatDate(dates[0], year);
    if (dates[1]) checkOut = formatDate(dates[1], year);
    const d1 = parseDay(checkIn), d2 = parseDay(checkOut);
    if (d1 != null && d2 != null && d2 > d1) nights = d2 - d1;
  }

  // Adults: "Total Pax : 01 ADULTS"
  const adults = parseInt(grab(/Total\s*Pax\s*:?\s*0*(\d+)/i) || grab(/0*(\d+)\s*ADULTS?/i) || "1", 10);

  // Room line: "Room :02 DELUXE ROOM BB BASIS + EB"
  const roomLine = grab(/Room\s*:?\s*([^\n\r]+)/i);
  let roomType = "Deluxe Room", meal = "", roomCount = 1;
  const hotelLine = grab(/Hotel\s*:?\s*([^\n\r]+)/i);
  if (roomLine) {
    const rc = roomLine.match(/^0*(\d+)\s/); if (rc) roomCount = parseInt(rc[1], 10);
    const rtM = roomLine.match(/(Deluxe Room|Standard Room|Superior Room|Suite|Family Room|Studio)/i);
    if (rtM) roomType = titleCase(rtM[1]);
    const mealM = roomLine.match(/\b(BB|HB|FB|RO|AI|CP|MAP|AP|EP)\b/i);
    if (mealM) meal = mealM[1].toUpperCase();
  }
  if (!meal && hotelLine) { const m = hotelLine.match(/\b(BB|HB|FB|RO|AI)\b/i); if (m) meal = m[1].toUpperCase(); }

  // Rate — can be on the Room line OR a separate line. Handle several styles:
  //   "185 AED / - PER ROOM PER NIGHT"
  //   "270+15 & eb 125 / - PER ROOM PER NIGHT"   (base 270+15, extra bed 125)
  //   "AED 285 ... + AED 125 ... EXTRA BED"
  let rate = 0, extra = 0;
  // Extra bed first (so we don't mistake it for the base). Keep it on the SAME line:
  // match "eb 125" / "e.b 125" / "extra bed 125" where digits follow on the same line
  // (use [ \t]* so a newline can't let it grab a number from the next line, e.g. "+ EB\n270").
  const ebM = text.match(/\be\.?\s*b\.?[ \t]*([\d,]+(?:\.\d+)?)/i)
    || text.match(/extra\s*bed[^\n\d]{0,10}([\d,]+(?:\.\d+)?)/i)
    || text.match(/([\d,]+(?:\.\d+)?)[ \t]{0,20}(?:for\s*)?extra\s*bed/i);
  if (ebM) extra = parseFloat(ebM[1].replace(/,/g, ""));
  // Base rate: a "a+b" pair (e.g. 270+15) sums into the per-room rate.
  const sumM = text.match(/\b(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)\b/);
  if (sumM) {
    rate = parseFloat(sumM[1]) + parseFloat(sumM[2]);
  } else {
    const rM = (roomLine && (roomLine.match(/([\d,]+(?:\.\d+)?)\s*AED/i) || roomLine.match(/AED\s*([\d,]+(?:\.\d+)?)/i)))
      || text.match(/AED\s*([\d,]+(?:\.\d+)?)\s*(?:PER\s*ROOM|PER\s*NIGHT)/i)
      || text.match(/([\d,]+(?:\.\d+)?)\s*(?:\/\s*-\s*)?PER\s*ROOM/i);
    if (rM) rate = parseFloat(rM[1].replace(/,/g, ""));
  }

  // Distribute guests/adults across rooms. The lead name applies to the first room;
  // remaining adults are spread so each room shows a sensible occupancy.
  const totalAdults = adults || 1;
  const perRoom = Math.max(1, Math.round(totalAdults / (roomCount || 1)));
  for (let i = 0; i < (roomCount || 1); i++) {
    // extra bed applies when a room holds 3+ guests (triple occupancy)
    const roomAdults = (i === roomCount - 1)
      ? totalAdults - perRoom * (roomCount - 1)   // remainder to last room
      : perRoom;
    data.rooms.push({
      guests: i === 0 && guest ? [guest.toUpperCase()] : [],
      checkIn, checkOut, nights: nights || 1,
      roomType, meal: meal || "BB",
      adults: roomAdults > 0 ? roomAdults : perRoom, children: 0,
      rate, extra: (roomAdults >= 3 ? extra : (roomCount === 1 ? extra : 0)),
    });
  }
  return data;
}
function monthName(abbr) {
  if (!abbr) return "";
  return MONTHS[abbr.slice(0, 3).toLowerCase()] || titleCase(abbr);
}

/* ---- Format 2: LABELED single/multi booking (Darina-style) ------------------ */
function parseLabeled(text, forcedYear) {
  const data = { confNumber: "", company: "", rooms: [] };
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = (forcedYear && String(forcedYear).trim()) || (yearMatch ? yearMatch[1] : CURRENT_YEAR);

  const grab = (re) => { const m = text.match(re); return m ? m[1].trim() : ""; };

  // Company: prefer an email domain, else a "From:" / company name near the top.
  const email = grab(/E-?mail\s*:\s*[\w.+-]+@([\w.-]+)/i);
  if (email) {
    // darinaholidays.ae -> DARINA HOLIDAYS
    let base = email.split(".")[0];
    base = base.replace(/holidays/i, " Holidays").replace(/tourism/i, " Tourism")
               .replace(/travel/i, " Travel").replace(/vacations?/i, " Vacations");
    data.company = base.replace(/([a-z])([A-Z])/g, "$1 $2").trim();
    if (!/holidays|tourism|travel|vacation/i.test(data.company)) {
      // domain had no keyword; just use the domain base
      data.company = email.split(".")[0];
    }
  }
  const greet = text.match(/(?:Greetings?|Regards?)\s+From\s+(.+)/i);
  if (greet) data.company = greet[1].replace(/[!*:,.\s]+$/g, "").trim();

  // Confirmation number: "Conf. No.: 12345" (ignore "From Allocation" placeholder)
  const conf = grab(/Conf\.?\s*No\.?\s*:\s*([^\n\r]+)/i);
  if (conf && !/from allocation|allocation|supplier|n\/?a|^-+$/i.test(conf)) {
    const digits = conf.match(/\d+/);
    data.confNumber = digits ? digits[0] : conf.trim();
  }

  // One or more booking blocks. Split on each "Check In:" occurrence to support multiple.
  const blocks = text.split(/(?=Check\s*In\s*:)/i).filter((b) => /Check\s*In\s*:/i.test(b));
  for (const blk of blocks) {
    const checkInRaw = (blk.match(/Check\s*In\s*:\s*([0-9]{1,2}[\s\-\/][A-Za-z0-9]{2,}[\-\/0-9]*)/i) || [])[1] || "";
    const checkOutRaw = (blk.match(/Check\s*Out\s*:\s*([0-9]{1,2}[\s\-\/][A-Za-z0-9]{2,}[\-\/0-9]*)/i) || [])[1] || "";
    let nights = parseInt((blk.match(/Nights?\s*:\s*(\d+)/i) || [])[1] || "0", 10);

    // Room type + meal plan from "Room Type: DBL / DELUXE ROOM / RO"
    const rt = (blk.match(/Room\s*Type\s*:\s*([^\n\r]+)/i) || [])[1] || "";
    let roomType = "Deluxe Room", meal = "";
    if (rt) {
      const parts = rt.split("/").map((s) => s.trim()).filter(Boolean);
      const rtPart = parts.find((p) => /room|suite|deluxe|standard|superior|studio/i.test(p));
      if (rtPart) roomType = titleCase(rtPart);
      const mealPart = parts.find((p) => /^(BB|HB|FB|RO|AI|CP|MAP|AP|EP)$/i.test(p));
      if (mealPart) meal = mealPart.toUpperCase();
    }

    const adults = parseInt((blk.match(/(?:No\.?\s*of\s*)?Adult'?s?\s*:\s*(\d+)/i) || [])[1] || "0", 10);
    const children = parseInt((blk.match(/(?:No\.?\s*of\s*)?Child'?s?(?:ren)?\s*:\s*(\d+)/i) || [])[1] || "0", 10);
    const names = ((blk.match(/Names?\s*:\s*([^\n\r]+)/i) || [])[1] || "").trim();

    // Rate: prefer "Sum Total : 265.00", else first number in a rate row like "DBL 265.00"
    let total = parseFloat((blk.match(/Sum\s*Total\s*:?\s*([\d,]+(?:\.\d+)?)/i) || [])[1]?.replace(/,/g, "") || "0");
    if (!total) {
      const rateRow = blk.match(/\b([A-Z]{2,4})\s+([\d,]+\.\d{2})/);
      if (rateRow) total = parseFloat(rateRow[2].replace(/,/g, ""));
    }
    if (!nights) {
      const d1 = parseDay(formatDate(checkInRaw, year)), d2 = parseDay(formatDate(checkOutRaw, year));
      if (d1 != null && d2 != null && d2 > d1) nights = d2 - d1;
    }
    const perNight = nights ? +(total / nights).toFixed(2) : total;

    data.rooms.push({
      guests: names ? [names.toUpperCase()] : [],
      checkIn: formatDate(checkInRaw, year),
      checkOut: formatDate(checkOutRaw, year),
      nights: nights || 1,
      roomType, meal: meal || "RO",
      adults: adults || 1, children,
      rate: perNight, extra: 0,
    });
  }
  return data;
}

/* ---- Format 1: TABULAR per-guest rows (Ghai-style) -------------------------- */
function parseTabular(text, forcedYear) {
  const data = { confNumber: "", company: "", rooms: [] };
  const rawLines = text.split(/\r?\n/);

  // Company: "Greetings/Regards From X"
  for (const line of rawLines) {
    const m = line.match(/(?:Greetings?|Regards?|Warm\s+Regards?|Hello)\s+(?:From|from)\s+(.+)/i);
    if (m) { data.company = m[1].replace(/[!*:,.\s]+$/g, "").trim(); break; }
  }

  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = (forcedYear && String(forcedYear).trim()) || (yearMatch ? yearMatch[1] : CURRENT_YEAR);

  // Clean a line into just the guest-name portion (strip serial, dates, room words, counts…)
  function nameOnly(line) {
    return line
      .replace(/^\s*\d+[\).\s]+/, "")
      .replace(DATE_RE, " ")
      .replace(COST_RE, " ")
      .replace(/Deluxe Room|Standard Room|Superior Room|Suite|Family Room|With Extra Bed|Extra Bed|Room Details|Room/gi, " ")
      .replace(ADULT_RE, " ")
      .replace(NIGHTS_RE, " ")
      .replace(MEAL_RE, " ")
      .replace(/\b\d+\b/g, " ")
      .replace(/[|]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  const isNoise = (line) =>
    /NAME OF PAX|S\.?\s*NO\b|CHECK\s*-?\s*IN|CHECK\s*-?\s*OUT|ROOM DETAILS|ADULTS?\b|NIGHTS?\b|MEAL\b|COST\b/i.test(line) && !findDates(line).length && !COST_RE.test(line) ||
    /Kindly proceed|Rooms?\s+Booking|requirements/i.test(line) ||
    /^(Greetings?|Regards?|Warm|Hello|Dear)\b/i.test(line);

  // Does this line look like a pure person name? (letters/spaces/dots, no digits, not a keyword)
  function looksLikeName(line) {
    if (findDates(line).length) return false;
    if (COST_RE.test(line)) return false;
    if (/\d/.test(line)) return false;
    if (/Deluxe|Standard|Superior|Suite|Family|Extra Bed|Room|Adult|Night|\bBB\b|\bHB\b|\bRO\b|\bFB\b/i.test(line)) return false;
    const letters = line.replace(/[^A-Za-z]/g, "");
    return letters.length >= 3;
  }

  let current = null;
  let dateCount = 0;       // 0 => next date is check-in (new room), 1 => next date is check-out
  let pendingNames = [];   // names seen before a room's dates (cell-per-line layout)

  function openRoom(checkIn) {
    current = {
      guests: [], checkIn, checkOut: "",
      nights: 0, roomType: "Deluxe Room", meal: "", adults: 0, rate: 0, extra: 0,
    };
    data.rooms.push(current);
    // the lead guest of this room = the FIRST pending name collected since the last room
    if (pendingNames.length) current.guests.push(pendingNames[0].toUpperCase());
    pendingNames = [];
  }

  function attachAttributes(room, line, cost, isExtra) {
    const roomTypeM = line.match(/(Deluxe Room|Standard Room|Superior Room|Suite|Family Room)/i);
    if (roomTypeM) room.roomType = titleCase(roomTypeM[1]);
    const a = line.match(ADULT_RE); if (a && !room.adults) room.adults = parseInt(a[1], 10);
    const n = line.match(NIGHTS_RE); if (n && !room.nights) room.nights = parseInt(n[1], 10);
    const meal = line.match(MEAL_RE); if (meal && !room.meal) room.meal = meal[1].toUpperCase();
    if (cost) {
      if (isExtra) { room.extra = parseFloat(cost[1]); if (!room._costNights) room._costNights = parseInt(cost[2], 10); }
      else if (!room.rate) { room.rate = parseFloat(cost[1]); room._costNights = parseInt(cost[2], 10); }
    }
  }

  for (let raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;
    if (isNoise(line)) continue;

    const dates = findDates(line);
    const cost = line.match(COST_RE);
    const isExtra = EXTRA_BED_RE.test(line);

    // Pure name line (cell-per-line layout): buffer it until a room's dates appear.
    if (looksLikeName(line)) {
      // If we're mid-room (check-in seen, awaiting check-out) treat extra names as roommates (ignored for lead).
      if (dateCount === 1) { /* roommate of current room, lead already set */ }
      else pendingNames.push(line);
      continue;
    }

    if (dates.length === 0) {
      // attribute-only line (room type / counts / meal / cost / extra bed)
      if (current) attachAttributes(current, line, cost, isExtra);
      continue;
    }

    // Line HAS one or more dates. In columnar layout the guest name is on this same line.
    const inlineName = nameOnly(line);
    for (let di = 0; di < dates.length; di++) {
      if (dateCount === 0) {
        openRoom(formatDate(dates[di], year));
        dateCount = 1;
        // columnar: name present on the check-in line itself
        if (di === 0 && inlineName && looksLikeInlineName(inlineName) && !current.guests.length) {
          current.guests.push(inlineName.toUpperCase());
        }
      } else {
        if (current) current.checkOut = formatDate(dates[di], year);
        dateCount = 0;
      }
    }
    if (current) attachAttributes(current, line, cost, isExtra);
  }

  function looksLikeInlineName(name) {
    const letters = name.replace(/[^A-Za-z]/g, "");
    return letters.length >= 3 && !/^(X|AED|TOTAL)$/i.test(name.trim());
  }

  // Fallbacks
  data.rooms.forEach((r) => {
    if (!r.nights && r._costNights) r.nights = r._costNights;
    if (!r.nights) {
      const d1 = parseDay(r.checkIn), d2 = parseDay(r.checkOut);
      if (d1 != null && d2 != null && d2 > d1) r.nights = d2 - d1;
    }
    if (!r.meal) r.meal = "BB";
    if (!r.adults) r.adults = r.guests.length || 1;
    delete r._costNights;
  });

  return data;
}

function titleCase(s) { return s.replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase()); }
function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/* =========================================================================
   RENDER — the hotel's exact confirmation format
   ========================================================================= */
function num(v) { v = Number(v) || 0; return Number.isInteger(v) ? String(v) : v.toFixed(2); }
function esc(s) { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function tr(label, val) { return `<tr><th>${label}</th><td>${val}</td></tr>`; }

// Per-room per-night subtotal including extra bed + TD (Tourism Dirham).
function roomPerNight(r) { return (Number(r.rate) || 0) + (Number(r.extra) || 0) + (Number(r.td) || 0); }
function roomTotal(r) { return roomPerNight(r) * (Number(r.nights) || 0); }

function rateHtml(r) {
  const nightWord = r.nights === 1 ? "NIGHT" : "NIGHTS";
  const td = Number(r.td) || 0;
  const extra = Number(r.extra) || 0;
  // Build the "base (+ extra) (+ TD) X nights" formula line.
  let parts = [num(r.rate)];
  if (extra > 0) parts.push(num(extra));
  if (td > 0) parts.push(`${num(td)} TD`);
  const formula = parts.join(" + ");
  const sub = roomTotal(r);
  return `<span class="rate-line">${formula} X ${r.nights} ${nightWord} = AED ${num(sub)}</span>` +
         `<span class="rate-line rate-total">Total = AED ${num(sub)}</span>`;
}

function render(data, nonRefundable) {
  // A "group" booking (many identical rooms) is shown as ONE summary table + a total,
  // instead of printing 17 identical tables.
  const isGroup = data.rooms.length > 1 && data.rooms.every((r) => r._group) ;
  const multi = data.rooms.length > 1 && !isGroup;
  let grand = 0;

  let tables;
  if (isGroup) {
    const r = data.rooms[0];
    const roomCount = r._roomCount || data.rooms.length;
    const guest = (r.guests[0] || "").toUpperCase();
    const nightsLabel = `${r.nights} ${r.nights === 1 ? "Night" : "Nights"}`;
    grand = roomTotal(r) * roomCount;
    const tdLabel = (Number(r.td) || 0) > 0 ? `AED ${num(r.td)} per room per night (Tourism Dirham)` : "Direct payment";
    tables = `
      <table>
        ${tr("Hotel Confirmation", esc(data.confNumber))}
        ${data.company ? tr("Company Name", esc(data.company.toUpperCase())) : ""}
        ${tr("Guest Name", esc(guest))}
        ${tr("Check In", esc(r.checkIn))}
        ${tr("Check Out", esc(r.checkOut))}
        ${tr("Duration of Stay", nightsLabel)}
        ${tr("No. of Rooms", String(roomCount))}
        ${tr("Room Type", esc(r.roomType))}
        ${tr("Meal Plan", esc(r.meal))}
        ${tr("Rate per Night", rateHtml(r))}
        ${tr("Rooms Total", `<span class="rate-total">${num(roomTotal(r))} X ${roomCount} ROOMS = AED ${num(grand)}</span>`)}
        ${tr("TD", `<span class="td-badge">${esc(tdLabel)}</span>`)}
      </table>`;
  } else {
    tables = data.rooms.map((r, i) => {
      grand += roomTotal(r);
      const guest = (r.guests[0] || "").toUpperCase();
      const nightsLabel = `${r.nights} ${r.nights === 1 ? "Night" : "Nights"}`;
      const guestCount = r.adults ? `${r.adults} Adult${r.adults > 1 ? "s" : ""}` : "";
      const header = multi ? `<div class="room-header">Room ${i + 1} of ${data.rooms.length}</div>` : "";
      return `${header}
      <table>
        ${tr("Hotel Confirmation", esc(data.confNumber))}
        ${data.company ? tr("Company Name", esc(data.company.toUpperCase())) : ""}
        ${tr("Guest Name", esc(guest))}
        ${tr("Check In", esc(r.checkIn))}
        ${tr("Check Out", esc(r.checkOut))}
        ${tr("Duration of Stay", nightsLabel)}
        ${tr("Room Type", esc(r.roomType))}
        ${tr("Meal Plan", esc(r.meal))}
        ${tr("Total Guests", esc(guestCount))}
        ${tr("Rate per Night", rateHtml(r))}
        ${tr("TD", `<span class="td-badge">TD Direct payment</span>`)}
      </table>`;
    }).join("");
  }

  const grandHtml = (multi || isGroup) ? `<p class="rate-total" style="text-align:right;">Grand Total = AED ${num(grand)}</p>` : "";

  const nr = nonRefundable;
  // Group bookings get extra deposit / final-balance remarks.
  const groupNotes = isGroup ? `
      <li>✔ <strong>Deposit:</strong> A 50% advance payment of the total reservation amount is required 14 days prior to the guest's arrival date to guarantee and secure the booking.</li>
      <li>✔ <strong>Final Balance:</strong> The remaining 50% balance is due and payable no later than 2 days prior to arrival.</li>` : "";
  const notes = `
    <p class="notes-title">Additional Notes:</p>
    <ul class="notes">
      <li>✔ <strong>Deposit Policy:</strong> A refundable deposit of AED 200 is required at check-in. This amount will be refunded upon check-out after room inspection, provided no damages or incidental charges apply.</li>
      <li>✔ <strong>Check-in/out Times:</strong> 14:00 (2 PM) / 12:00 (Noon)</li>
      ${nr ? "" : `<li>✔ <strong>Cancellation Policy:</strong> Free cancellation until 14 days before arrival. Late cancellations incur one night's charge.</li>
      <li>✔ <strong>Early Departure:</strong> 50% penalty charges applicable</li>
      <li>✔ <strong>Payment:</strong> Room charges to be settled 14 days before arrival</li>`}${groupNotes}
      <li>✔ <strong>Parking:</strong> Basement paid parking available at AED 25 per day.</li>
      <li>✔ <strong>Visitor Policy:</strong> Only registered guests are permitted in the room. Any additional visitors beyond the booked occupancy will be subject to additional charges as per the hotel policy.</li>
    </ul>`;

  return `
    <p>Dear Reservation Team,</p>
    <p>Greetings,</p>
    <p>We are pleased to confirm your reservation in Dubai, as per the following details:</p>
    ${tables}
    ${grandHtml}
    ${notes}`;
}

/* =========================================================================
   EMAIL RENDER — same content but with INLINE styles so Outlook/Gmail keep
   the table borders & formatting when pasted. (Outlook ignores <style> tags
   and CSS classes, so every style must live on the element itself.)
   ========================================================================= */
// Signature banner image. When a signature image is available it is embedded here as an
// <img> tag (base64 data URI so it survives copy-paste into Outlook). Empty by default.
const SIGNATURE_IMG = (typeof SIGNATURE_DATA_URL !== "undefined" && SIGNATURE_DATA_URL)
  ? `<p style="margin:14px 0;"><img src="${SIGNATURE_DATA_URL}" alt="Grand Central Hotel" style="max-width:620px;width:100%;height:auto;border:0;display:block;"></p>`
  : "";

const S = {
  table: "border-collapse:collapse;width:100%;max-width:640px;margin:14px 0 20px;font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1a1a1a;",
  th: "border:1px solid #c9c9c9;background:#f3ead3;color:#4a3c15;text-align:left;padding:8px 12px;font-weight:bold;width:34%;vertical-align:top;",
  td: "border:1px solid #c9c9c9;padding:8px 12px;text-align:left;vertical-align:top;",
  roomHeader: "background:#2e3a46;color:#e3c171;padding:8px 12px;font-weight:bold;font-family:Segoe UI,Arial,sans-serif;font-size:14px;margin:18px 0 0;",
  badge: "background:#fff3cd;color:#7a5c00;font-weight:bold;padding:2px 8px;border-radius:4px;",
  p: "font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1a1a1a;margin:0 0 12px;",
  li: "font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1a1a1a;margin:0 0 8px;",
  title: "font-family:Segoe UI,Arial,sans-serif;font-size:14px;font-weight:bold;margin:18px 0 8px;",
  ovTitle: "font-family:Segoe UI,Arial,sans-serif;font-size:14px;font-weight:bold;color:#1a4a7a;margin:18px 0 8px;",
};

function trE(label, val) {
  return `<tr><td style="${S.th}">${label}</td><td style="${S.td}">${val}</td></tr>`;
}

function rateEmail(r) {
  const nightWord = r.nights === 1 ? "NIGHT" : "NIGHTS";
  const extra = Number(r.extra) || 0, td = Number(r.td) || 0;
  let parts = [num(r.rate)];
  if (extra > 0) parts.push(num(extra));
  if (td > 0) parts.push(`${num(td)} TD`);
  const total = roomTotal(r);
  return `${esc(parts.join(" + "))} X ${r.nights} ${nightWord} = AED ${num(total)}<br><strong>Total = AED ${num(total)}</strong>`;
}

function renderEmail(data, nonRefundable) {
  const isGroup = data.rooms.length > 1 && data.rooms.every((r) => r._group);
  const multi = data.rooms.length > 1 && !isGroup;
  let grand = 0;

  let tables;
  if (isGroup) {
    const r = data.rooms[0];
    const roomCount = r._roomCount || data.rooms.length;
    const guest = (r.guests[0] || "").toUpperCase();
    const nightsLabel = `${r.nights} ${r.nights === 1 ? "Night" : "Nights"}`;
    grand = roomTotal(r) * roomCount;
    const tdLabel = (Number(r.td) || 0) > 0 ? `AED ${num(r.td)} per room per night (Tourism Dirham)` : "Direct payment";
    tables = `
      <table style="${S.table}" cellpadding="0" cellspacing="0" border="1">
        ${trE("Hotel Confirmation", esc(data.confNumber))}
        ${data.company ? trE("Company Name", esc(data.company.toUpperCase())) : ""}
        ${trE("Guest Name", esc(guest))}
        ${trE("Check In", esc(r.checkIn))}
        ${trE("Check Out", esc(r.checkOut))}
        ${trE("Duration of Stay", nightsLabel)}
        ${trE("No. of Rooms", String(roomCount))}
        ${trE("Room Type", esc(r.roomType))}
        ${trE("Meal Plan", esc(r.meal))}
        ${trE("Rate per Night", rateEmail(r))}
        ${trE("Rooms Total", `<strong>${num(roomTotal(r))} X ${roomCount} ROOMS = AED ${num(grand)}</strong>`)}
        ${trE("TD", `<span style="${S.badge}">${esc(tdLabel)}</span>`)}
      </table>`;
  } else {
    tables = data.rooms.map((r, i) => {
      grand += roomTotal(r);
      const guest = (r.guests[0] || "").toUpperCase();
      const nightsLabel = `${r.nights} ${r.nights === 1 ? "Night" : "Nights"}`;
      const guestCount = r.adults ? `${r.adults} Adult${r.adults > 1 ? "s" : ""}` : "";
      const header = multi ? `<div style="${S.roomHeader}">Room ${i + 1} of ${data.rooms.length}</div>` : "";
      return `${header}
      <table style="${S.table}" cellpadding="0" cellspacing="0" border="1">
        ${trE("Hotel Confirmation", esc(data.confNumber))}
        ${data.company ? trE("Company Name", esc(data.company.toUpperCase())) : ""}
        ${trE("Guest Name", esc(guest))}
        ${trE("Check In", esc(r.checkIn))}
        ${trE("Check Out", esc(r.checkOut))}
        ${trE("Duration of Stay", nightsLabel)}
        ${trE("Room Type", esc(r.roomType))}
        ${trE("Meal Plan", esc(r.meal))}
        ${trE("Total Guests", esc(guestCount))}
        ${trE("Rate per Night", rateEmail(r))}
        ${trE("TD", `<span style="${S.badge}">TD Direct payment</span>`)}
      </table>`;
    }).join("");
  }

  const grandHtml = (multi || isGroup) ? `<p style="${S.p}text-align:right;"><strong>Grand Total = AED ${num(grand)}</strong></p>` : "";

  const nr = nonRefundable;
  // Outlook IGNORES CSS margins on pasted <p> tags, which is why lines looked cramped.
  // The reliable fix: one line per <div> plus EMPTY spacer lines (<div>&nbsp;</div>)
  // between sections — Outlook always honours actual line content.
  const L = "font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.5;";
  const line = (html) => `<div style="${L}">${html}</div>`;
  const blank = `<div style="${L}">&nbsp;</div>`;
  const bold = (html) => `<div style="${L}font-weight:bold;">${html}</div>`;

  const noteLines = [
    `✔ <strong>Deposit Policy:</strong> A refundable deposit of AED 200 is required at check-in. This amount will be refunded upon check-out after room inspection, provided no damages or incidental charges apply.`,
    `✔ <strong>Check-in/out Times:</strong> 14:00 (2 PM) / 12:00 (Noon)`,
    ...(nr ? [] : [
      `✔ <strong>Cancellation Policy:</strong> Free cancellation until 14 days before arrival. Late cancellations incur one night's charge.`,
      `✔ <strong>Early Departure:</strong> 50% penalty charges applicable`,
      `✔ <strong>Payment:</strong> Room charges to be settled 14 days before arrival`,
    ]),
    ...(isGroup ? [
      `✔ <strong>Deposit:</strong> A 50% advance payment of the total reservation amount is required 14 days prior to the guest's arrival date to guarantee and secure the booking.`,
      `✔ <strong>Final Balance:</strong> The remaining 50% balance is due and payable no later than 2 days prior to arrival.`,
    ] : []),
    `✔ <strong>Parking:</strong> Basement paid parking available at AED 25 per day.`,
    `✔ <strong>Visitor Policy:</strong> Only registered guests are permitted in the room. Any additional visitors beyond the booked occupancy will be subject to additional charges as per the hotel policy.`,
  ].map(line).join("");

  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1a1a1a;">
    ${line("Dear Reservation Team,")}
    ${blank}
    ${line("Greetings,")}
    ${blank}
    ${line("We are pleased to confirm your reservation in Dubai, as per the following details:")}
    ${blank}
    ${tables}
    ${grandHtml}
    ${blank}
    ${bold("Additional Notes:")}
    ${noteLines}
    ${SIGNATURE_IMG}
  </div>`;
}

/* =========================================================================
   WIRING
   ========================================================================= */
const EXAMPLE = `Greetings From Ghai Holidays !!!!!!!!!!!

Kindly proceed 4 Rooms Booking as per the below requirements :-

S.NO   NAME OF PAX               CHECK-IN  CHECK-OUT  ROOM DETAILS     ADULTS    NIGHTS  MEAL  COST
1      AMANDEEP SINGH KHANGURA   14-Oct    18-Oct     Deluxe Room      3 Adult   4       BB    200 x 4 = 800
2      KARANVEER SINGH                                With Extra Bed                           70 x 4 = 280
3      UCHVIR SINGH

4      RANJIT SINGH              14-Oct    19-Oct     Deluxe Room      2 Adult   5       BB    200 x 5 = 1000
5      KULWINDER KAUR
6      MANJOT SINGH              14-Oct    19-Oct     Deluxe Room      2 Adult   5       BB    200 x 5 = 1000
7      HARSIMRAN KAUR                                 With Extra Bed                           70 x 5 = 350
8      SARPREET KAUR MANGAT

9      SARPREET KAUR MANGAT      13-Oct    14-Oct     Deluxe Room      1 Adult   1       BB    200 x 1 = 200`;

function generate() {
  const text = el("input").value.trim();
  if (!text) { setStatus("err", "Please paste the booking text first."); return; }
  let data;
  try {
    data = parseBooking(text, el("year").value);
  } catch (e) {
    setStatus("err", "Could not parse: " + e.message);
    return;
  }
  if (!data.rooms.length) { setStatus("err", "No rooms detected. Check the text format."); return; }
  data.confNumber = el("confNumber").value.trim();
  lastData = data;
  lastNonRefundable = el("nonRefundable").checked;
  el("rawJson").textContent = JSON.stringify(data, null, 2);
  el("confirmationOutput").innerHTML = render(data, lastNonRefundable);
  el("resultCard").hidden = false;
  setStatus("ok", `✓ Detected ${data.rooms.length} room(s). Review below.`);
  el("resultCard").scrollIntoView({ behavior: "smooth" });
}

el("generateBtn").addEventListener("click", generate);
el("exampleBtn").addEventListener("click", () => { el("input").value = EXAMPLE; setStatus("", ""); });
el("clearBtn").addEventListener("click", () => { el("input").value = ""; el("resultCard").hidden = true; setStatus("", ""); });

function setStatus(cls, msg) {
  const s = el("status");
  s.className = "status" + (cls ? " " + cls : "");
  s.textContent = msg;
}

/* ---- Copy / Download / Print ---- */
const out = () => el("confirmationOutput");
el("copyHtmlBtn").addEventListener("click", async () => {
  // Build Outlook-safe HTML with INLINE styles so the table formatting survives the paste.
  const emailHtml = lastData ? renderEmail(lastData, lastNonRefundable) : out().innerHTML;
  const plain = out().innerText;
  try {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([emailHtml], { type: "text/html" }),
      "text/plain": new Blob([plain], { type: "text/plain" }),
    })]);
    flash("copyHtmlBtn");
  } catch {
    // Fallback: render the inline-styled HTML into a temp element and copy via selection
    const tmp = document.createElement("div");
    tmp.style.position = "fixed"; tmp.style.left = "-9999px";
    tmp.innerHTML = emailHtml;
    document.body.appendChild(tmp);
    const r = document.createRange(); r.selectNodeContents(tmp);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.execCommand("copy");
    s.removeAllRanges(); document.body.removeChild(tmp);
    flash("copyHtmlBtn");
  }
});
el("copyTextBtn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(out().innerText); flash("copyTextBtn");
});
el("downloadBtn").addEventListener("click", () => {
  const body = lastData ? renderEmail(lastData, lastNonRefundable) : out().innerHTML;
  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Grand Central Hotel Confirmation</title></head>
  <body style="margin:24px;">${body}</body></html>`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([doc], { type: "text/html" }));
  a.download = "grand-central-confirmation.html"; a.click();
});
el("printBtn").addEventListener("click", () => {
  const w = window.open("", "_blank");
  w.document.write(`<html><head><title>Confirmation</title>
  <style>table{width:100%;border-collapse:collapse;}th,td{border:1px solid #999;padding:8px;text-align:left;}th{background:#f3ead3;width:34%;}</style></head><body>${out().innerHTML}</body></html>`);
  w.document.close(); w.focus(); w.print();
});
function flash(id) { const b = el(id), t = b.textContent; b.textContent = "✓ Done"; setTimeout(() => (b.textContent = t), 1400); }

/* =========================================================================
   TABS (Paste Text / Upload Screenshot)
   ========================================================================= */
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const which = tab.dataset.tab;
    el("panel-paste").hidden = which !== "paste";
    el("panel-upload").hidden = which !== "upload";
    el("panel-pdf").hidden = which !== "pdf";
  });
});

/* =========================================================================
   PDF UPLOAD (PDF.js — in-browser text extraction, no API key)
   ========================================================================= */
const pdfDropZone = el("pdfDropZone");
const pdfInput = el("pdfInput");

if (pdfDropZone && pdfInput) {
  // Open the file picker on click (ignore clicks that originate from the input itself).
  pdfDropZone.addEventListener("click", (e) => {
    if (e.target === pdfInput) return;
    pdfInput.click();
  });
  pdfDropZone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pdfInput.click(); } });
  pdfInput.addEventListener("change", (e) => { if (e.target.files[0]) loadPdf(e.target.files[0]); });

  ["dragenter", "dragover"].forEach((ev) => pdfDropZone.addEventListener(ev, (e) => { e.preventDefault(); pdfDropZone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) => pdfDropZone.addEventListener(ev, (e) => { e.preventDefault(); pdfDropZone.classList.remove("dragover"); }));
  pdfDropZone.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadPdf(f); });
}

function setPdf(cls, msg) {
  const s = el("pdfStatus");
  s.className = "status" + (cls ? " " + cls : "");
  s.innerHTML = msg;
}

async function loadPdf(file) {
  if (!file || !/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
    return setPdf("err", "Please provide a PDF file.");
  }
  if (typeof pdfjsLib === "undefined") {
    return setPdf("err", "PDF library failed to load (check your internet connection, then reload).");
  }
  setPdf("working", `<span class="spinner"></span>Reading PDF…`);
  try {
    // Ensure the worker is configured (in case the inline setup ran before the lib loaded)
    if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js";
    }
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let out = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      // Reconstruct lines using each item's Y position so labels/values stay together.
      const rows = {};
      for (const item of content.items) {
        if (!item.str) continue;
        const y = Math.round(item.transform[5]); // vertical position
        (rows[y] = rows[y] || []).push({ x: item.transform[4], s: item.str });
      }
      const ys = Object.keys(rows).map(Number).sort((a, b) => b - a); // top-to-bottom
      for (const y of ys) {
        const lineText = rows[y].sort((a, b) => a.x - b.x).map((o) => o.s).join(" ")
          .replace(/\s{2,}/g, " ").trim();
        if (lineText) out += lineText + "\n";
      }
      out += "\n";
    }
    const text = out.trim();
    if (!text) { setPdf("err", "No selectable text found in this PDF. Try the Upload Screenshot (OCR) tab instead."); return; }
    el("input").value = text;
    setPdf("ok", "✓ PDF text extracted. Switch to “Paste Text” to review, then Generate.");
    document.querySelector('.tab[data-tab="paste"]').click();
  } catch (err) {
    setPdf("err", "Could not read PDF: " + err.message);
  }
}

/* =========================================================================
   SCREENSHOT UPLOAD + OCR (Tesseract.js, no API key)
   ========================================================================= */
let imageDataUrl = null;
const dropZone = el("dropZone");
const fileInput = el("fileInput");
const preview = el("preview");
const dropPrompt = el("dropPrompt");
const ocrBtn = el("ocrBtn");

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
fileInput.addEventListener("change", (e) => { if (e.target.files[0]) loadImage(e.target.files[0]); });

["dragenter", "dragover"].forEach((ev) => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add("dragover"); }));
["dragleave", "drop"].forEach((ev) => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove("dragover"); }));
dropZone.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) loadImage(f); });

// paste image only when the Upload tab is active
document.addEventListener("paste", (e) => {
  if (el("panel-upload").hidden) return;
  for (const item of e.clipboardData?.items || []) {
    if (item.type.startsWith("image/")) { loadImage(item.getAsFile()); break; }
  }
});

function loadImage(file) {
  if (!file || !file.type.startsWith("image/")) { setOcr("err", "Please provide an image."); return; }
  const reader = new FileReader();
  reader.onload = () => {
    imageDataUrl = reader.result;
    preview.src = imageDataUrl;
    preview.hidden = false;
    dropPrompt.hidden = true;
    ocrBtn.disabled = false;
    setOcr("", "");
  };
  reader.readAsDataURL(file);
}

ocrBtn.addEventListener("click", async () => {
  if (!imageDataUrl) { setOcr("err", "Upload a screenshot first."); return; }
  if (typeof Tesseract === "undefined") { setOcr("err", "OCR library failed to load (check your internet connection)."); return; }
  ocrBtn.disabled = true;
  setOcr("working", "🔍 Reading screenshot… this can take 10–30 seconds.");
  try {
    const { data } = await Tesseract.recognize(imageDataUrl, "eng", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          setOcr("working", `🔍 Reading… ${Math.round(m.progress * 100)}%`);
        }
      },
    });
    const text = (data.text || "").trim();
    if (!text) { setOcr("err", "No text detected. Try a clearer / larger screenshot."); ocrBtn.disabled = false; return; }
    el("input").value = text;
    setOcr("ok", "✓ Text extracted. Switch to “Paste Text” to review & fix, then Generate.");
    // auto-switch to paste tab so user can review
    document.querySelector('.tab[data-tab="paste"]').click();
  } catch (err) {
    setOcr("err", "OCR failed: " + err.message);
  } finally {
    ocrBtn.disabled = false;
  }
});

function setOcr(cls, msg) {
  const s = el("ocrStatus");
  s.className = "status" + (cls ? " " + cls : "");
  s.innerHTML = msg;
}

// Start with an EMPTY paste box; the year defaults to the current year.
// (Use the "Load Example" button to populate a sample booking.)
el("year").value = String(new Date().getFullYear());
