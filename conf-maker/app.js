"use strict";

const el = (id) => document.getElementById(id);
const roomsBox = el("rooms");
const roomTpl = el("roomTemplate");

// ---- Add / remove rooms ----
function addRoom() {
  const node = roomTpl.content.cloneNode(true);
  roomsBox.appendChild(node);
  renumber();
}
function renumber() {
  roomsBox.querySelectorAll(".room-block").forEach((b, i) => {
    b.querySelector(".room-label").textContent = "Room " + (i + 1);
  });
}
roomsBox.addEventListener("click", (e) => {
  if (e.target.classList.contains("remove-room")) {
    if (roomsBox.querySelectorAll(".room-block").length > 1) {
      e.target.closest(".room-block").remove();
      renumber();
    }
  }
});
el("addRoomBtn").addEventListener("click", addRoom);

el("resetBtn").addEventListener("click", () => {
  roomsBox.innerHTML = "";
  addRoom();
  el("confNumber").value = "";
  el("company").value = "";
  el("nonRefundable").checked = false;
  el("resultCard").hidden = true;
});

// ---- Read form ----
function readForm() {
  const rooms = [...roomsBox.querySelectorAll(".room-block")].map((b) => ({
    guests: b.querySelector(".f-guests").value.split(",").map((s) => s.trim()).filter(Boolean),
    roomType: b.querySelector(".f-roomtype").value.trim() || "Deluxe Room",
    checkIn: b.querySelector(".f-checkin").value.trim(),
    checkOut: b.querySelector(".f-checkout").value.trim(),
    nights: Number(b.querySelector(".f-nights").value) || 1,
    meal: b.querySelector(".f-meal").value.trim(),
    adults: Number(b.querySelector(".f-adults").value) || 0,
    children: Number(b.querySelector(".f-children").value) || 0,
    rate: Number(b.querySelector(".f-rate").value) || 0,
    extra: Number(b.querySelector(".f-extra").value) || 0,
  }));
  return {
    confNumber: el("confNumber").value.trim(),
    company: el("company").value.trim(),
    nonRefundable: el("nonRefundable").checked,
    rooms,
  };
}

// ---- Rate breakdown ----
function num(v) {
  v = Number(v) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
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

// ---- Render ----
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function tr(label, val) {
  return `<tr><th>${label}</th><td>${val}</td></tr>`;
}

function render(data) {
  const multi = data.rooms.length > 1;
  let grand = 0;

  const tables = data.rooms.map((r, i) => {
    grand += (r.rate + r.extra) * r.nights;
    const guests = r.guests.map((g) => g.toUpperCase()).join("<br>");
    const nightsLabel = `${r.nights} ${r.nights === 1 ? "Night" : "Nights"}`;
    let guestCount = r.adults ? `${r.adults} Adult${r.adults > 1 ? "s" : ""}` : "";
    if (r.children > 0) guestCount += `${guestCount ? ", " : ""}${r.children} Child${r.children > 1 ? "ren" : ""}`;
    const header = multi ? `<div class="room-header">Room ${i + 1} of ${data.rooms.length}</div>` : "";

    return `${header}
      <table>
        ${i === 0 ? tr("Hotel Confirmation", esc(data.confNumber)) : ""}
        ${data.company ? tr("Company Name", esc(data.company.toUpperCase())) : ""}
        ${tr("Guest Name", guests)}
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

  const nr = data.nonRefundable;
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

el("generateBtn").addEventListener("click", () => {
  const data = readForm();
  el("confirmationOutput").innerHTML = render(data);
  el("resultCard").hidden = false;
  el("resultCard").scrollIntoView({ behavior: "smooth" });
});

// ---- Copy / Download / Print ----
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
  ul.notes{list-style:none;padding:0;}ul.notes li{margin:0 0 8px;}a{color:#1a7a3a;}</style></head>
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

function flash(id) {
  const b = el(id), t = b.textContent;
  b.textContent = "✓ Done"; setTimeout(() => (b.textContent = t), 1400);
}

// ---- Prefill helper: load an example booking so the form isn't empty ----
function fillRoom(block, r) {
  block.querySelector(".f-guests").value = r.guest;
  block.querySelector(".f-roomtype").value = r.roomType;
  block.querySelector(".f-checkin").value = r.checkIn;
  block.querySelector(".f-checkout").value = r.checkOut;
  block.querySelector(".f-nights").value = r.nights;
  block.querySelector(".f-meal").value = r.meal;
  block.querySelector(".f-adults").value = r.adults;
  block.querySelector(".f-children").value = 0;
  block.querySelector(".f-rate").value = r.rate;
  block.querySelector(".f-extra").value = r.extra;
}

function loadExample() {
  el("company").value = "Ghai Holidays";
  const example = [
    { guest: "AMANDEEP SINGH KHANGURA", roomType: "Deluxe Room", checkIn: "14th October 2025", checkOut: "18th October 2025", nights: 4, meal: "BB", adults: 3, rate: 200, extra: 70 },
    { guest: "RANJIT SINGH",            roomType: "Deluxe Room", checkIn: "14th October 2025", checkOut: "19th October 2025", nights: 5, meal: "BB", adults: 2, rate: 200, extra: 0 },
    { guest: "MANJOT SINGH",            roomType: "Deluxe Room", checkIn: "14th October 2025", checkOut: "19th October 2025", nights: 5, meal: "BB", adults: 2, rate: 200, extra: 70 },
    { guest: "SARPREET KAUR MANGAT",    roomType: "Deluxe Room", checkIn: "13th October 2025", checkOut: "14th October 2025", nights: 1, meal: "BB", adults: 1, rate: 200, extra: 0 },
  ];
  roomsBox.innerHTML = "";
  example.forEach((r) => {
    addRoom();
    fillRoom(roomsBox.lastElementChild, r);
  });
}

// init — start with the example booking prefilled (edit or Reset to clear)
loadExample();
