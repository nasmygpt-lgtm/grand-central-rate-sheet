"use strict";

const el = (id) => document.getElementById(id);

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

function parseBooking(text, forcedYear) {
  const data = { confNumber: "", company: "", rooms: [] };
  const rawLines = text.split(/\r?\n/);

  // Company: "Greetings/Regards From X"
  for (const line of rawLines) {
    const m = line.match(/(?:Greetings?|Regards?|Warm\s+Regards?|Hello)\s+(?:From|from)\s+(.+)/i);
    if (m) {
      data.company = m[1].replace(/[!*:,.\s]+$/g, "").trim();
      break;
    }
  }

  // Year priority: user-provided > year found in text > current year
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = (forcedYear && String(forcedYear).trim()) || (yearMatch ? yearMatch[1] : CURRENT_YEAR);

  // Walk lines; a line that contains dates starts a NEW room.
  let current = null;

  for (let raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;
    // skip the table header row
    if (/NAME OF PAX|S\.?\s*NO\b|CHECK\s*-?\s*IN|CHECK\s*-?\s*OUT|ROOM DETAILS/i.test(line)) continue;
    // skip intro / greeting lines
    if (/Kindly proceed|Rooms?\s+Booking|requirements/i.test(line)) continue;
    if (/^(Greetings?|Regards?|Warm|Hello|Dear)\b/i.test(line)) continue;

    const dates = findDates(line);
    const cost = line.match(COST_RE);
    const isExtra = EXTRA_BED_RE.test(line);

    // Clean the name = strip leading serial number, dates, room words, counts, meal, cost
    let namePart = line
      .replace(/^\s*\d+[\).\s]+/, "")      // leading serial "1 " / "1) "
      .replace(DATE_RE, " ")
      .replace(COST_RE, " ")
      .replace(/Deluxe Room|Standard Room|Superior Room|Suite|With Extra Bed|Extra Bed|Room/gi, " ")
      .replace(ADULT_RE, " ")
      .replace(NIGHTS_RE, " ")
      .replace(MEAL_RE, " ")
      .replace(/\b\d+\b/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (dates && dates.length >= 1) {
      // NEW ROOM
      current = {
        guests: [],
        checkIn: formatDate(dates[0], year),
        checkOut: dates[1] ? formatDate(dates[1], year) : "",
        nights: 0, roomType: "Deluxe Room", meal: "", adults: 0, rate: 0, extra: 0,
      };
      const roomTypeM = line.match(/(Deluxe Room|Standard Room|Superior Room|Suite|Family Room)/i);
      if (roomTypeM) current.roomType = titleCase(roomTypeM[1]);
      const a = line.match(ADULT_RE); if (a) current.adults = parseInt(a[1], 10);
      const n = line.match(NIGHTS_RE); if (n) current.nights = parseInt(n[1], 10);
      const meal = line.match(MEAL_RE); if (meal) current.meal = meal[1].toUpperCase();
      if (cost) { current.rate = parseFloat(cost[1]); current._costNights = parseInt(cost[2], 10); }
      if (namePart) current.guests.push(namePart.toUpperCase());
      data.rooms.push(current);
    } else if (current) {
      // continuation line for current room
      if (isExtra && cost) {
        current.extra = parseFloat(cost[1]); // extra bed fee per night
        if (!current._costNights) current._costNights = parseInt(cost[2], 10);
      } else if (cost && !current.rate) {
        current.rate = parseFloat(cost[1]);
        current._costNights = parseInt(cost[2], 10);
      }
      // meal / nights / adults may appear on continuation lines too
      if (!current.meal) { const meal = line.match(MEAL_RE); if (meal) current.meal = meal[1].toUpperCase(); }
      if (!current.nights) { const n = line.match(NIGHTS_RE); if (n) current.nights = parseInt(n[1], 10); }
      if (!current.adults) { const a = line.match(ADULT_RE); if (a) current.adults = parseInt(a[1], 10); }
      if (namePart && !isExtra) current.guests.push(namePart.toUpperCase());
    }
  }

  // Fallbacks: derive nights from the cost formula (rate x nights) on the room itself,
  // else from the date difference; default meal BB.
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

function rateHtml(r) {
  const nightWord = r.nights === 1 ? "NIGHT" : "NIGHTS";
  if (r.extra > 0) {
    const sub = (r.rate + r.extra) * r.nights;
    return `<span class="rate-line">${num(r.rate)} + ${num(r.extra)} X ${r.nights} ${nightWord} = AED ${num(sub)}</span>` +
           `<span class="rate-line rate-total">Total = AED ${num(sub)}</span>`;
  }
  const sub = r.rate * r.nights;
  return `<span class="rate-line">${num(r.rate)} X ${r.nights} ${nightWord} = AED ${num(sub)}</span>` +
         `<span class="rate-line rate-total">Total = AED ${num(sub)}</span>`;
}

function render(data, nonRefundable) {
  const multi = data.rooms.length > 1;
  let grand = 0;

  const tables = data.rooms.map((r, i) => {
    grand += (r.rate + r.extra) * r.nights;
    // ONE guest name (lead/first) as requested
    const guest = (r.guests[0] || "").toUpperCase();
    const nightsLabel = `${r.nights} ${r.nights === 1 ? "Night" : "Nights"}`;
    const guestCount = r.adults ? `${r.adults} Adult${r.adults > 1 ? "s" : ""}` : "";
    const header = multi ? `<div class="room-header">Room ${i + 1} of ${data.rooms.length}</div>` : "";

    return `${header}
      <table>
        ${i === 0 ? tr("Hotel Confirmation", esc(data.confNumber)) : ""}
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

  const grandHtml = multi ? `<p class="rate-total" style="text-align:right;">Grand Total = AED ${num(grand)}</p>` : "";

  const nr = nonRefundable;
  const notes = `
    <p class="notes-title">Additional Notes:</p>
    <ul class="notes">
      <li>✔ <strong>Deposit Policy:</strong> A refundable deposit of AED 200 is required at check-in. This amount will be refunded upon check-out after room inspection, provided no damages or incidental charges apply.</li>
      <li>✔ <strong>Check-in/out Times:</strong> 14:00 (2 PM) / 12:00 (Noon)</li>
      ${nr ? "" : `<li>✔ <strong>Cancellation Policy:</strong> Free cancellation until 14 days before arrival. Late cancellations incur one night's charge.</li>
      <li>✔ <strong>Early Departure:</strong> 50% penalty charges applicable</li>
      <li>✔ <strong>Payment:</strong> Room charges to be settled 14 days before arrival</li>`}
      <li>✔ <strong>Parking:</strong> Basement paid parking available at AED 25 per day.</li>
      <li>✔ <strong>Visitor Policy:</strong> Only registered guests are permitted in the room. Any additional visitors beyond the booked occupancy will be subject to additional charges as per the hotel policy.</li>
    </ul>`;

  return `
    <p>Dear Reservation Team,</p>
    <p>Greetings from Grand Central Hotel,</p>
    <p>We are pleased to confirm your reservation at Grand Central Deira, Dubai, as per the following details:</p>
    ${tables}
    ${grandHtml}
    ${notes}
    <p class="overview-title">Grand Central Hotel – Quick Overview</p>
    <ul class="overview">
      <li>⭐ <strong>Star Rating:</strong> Marketed as a 4 star property with 140 rooms. It's centrally located in Deira near Al Rigga Road. Muraqqabat Street - Deira - Dubai</li>
      <li>📍 <strong>Location:</strong> Just a 3–4 minute walk (230 m) to Al Rigga Metro Station, offering seamless access to Dubai's transit network and attractions like Deira City Centre and the Dubai Museum</li>
    </ul>
    <p>Should you have any further concerns or feedback, please do not hesitate to reach out to us directly.</p>
    <div class="sign">
      <p>Thank you,</p>
      <p>Kind Regards<br>Naseem Mohamed<br>Whatsapp: <a href="https://wa.me/971553440486">https://wa.me/971553440486</a></p>
      <p>🌿 P Please don't print this email unless you really need to</p>
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
  el("rawJson").textContent = JSON.stringify(data, null, 2);
  el("confirmationOutput").innerHTML = render(data, el("nonRefundable").checked);
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
  try {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([out().innerHTML], { type: "text/html" }),
      "text/plain": new Blob([out().innerText], { type: "text/plain" }),
    })]);
    flash("copyHtmlBtn");
  } catch {
    const r = document.createRange(); r.selectNodeContents(out());
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.execCommand("copy"); flash("copyHtmlBtn");
  }
});
el("copyTextBtn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(out().innerText); flash("copyTextBtn");
});
el("downloadBtn").addEventListener("click", () => {
  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Confirmation</title>
  <style>body{font-family:Segoe UI,Arial,sans-serif;color:#1a1a1a;max-width:720px;margin:30px auto;padding:0 20px;}
  table{width:100%;border-collapse:collapse;margin:16px 0 22px;}th,td{border:1px solid #d7dde3;padding:9px 12px;text-align:left;vertical-align:top;}
  th{background:#f3ead3;width:34%;}.rate-line{display:block;}.rate-total{font-weight:700;}
  .td-badge{background:#fff3cd;color:#7a5c00;font-weight:700;padding:2px 8px;border-radius:5px;}
  .room-header{background:#2e3a46;color:#e3c171;padding:8px 12px;border-radius:6px;margin:22px 0 8px;font-weight:700;}
  ul.notes{list-style:none;padding:0;}ul.notes li{margin:0 0 8px;}.overview-title{color:#1a4a7a;font-weight:700;}a{color:#1a7a3a;}</style></head>
  <body>${out().innerHTML}</body></html>`;
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
  });
});

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

// start with example loaded
el("input").value = EXAMPLE;
