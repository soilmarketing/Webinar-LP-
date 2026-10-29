// api/register.js
// Matches the form in index.html (Placement Spotlight landing page).
// Receives: firstName, lastName, email, phone, programme, source
// Returns:  { ok: true, joinUrl }
//
// Vercel Environment Variables required:
//   ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET
//   ZOOM_EVENT_ID    -> the Webinar ID (numbers only)
//   ZOOM_EVENT_TYPE  -> "webinar"

// Must match the custom question title on the Zoom webinar exactly.
const PROGRAM_QUESTION = "Any SOIL program you are interested in?";

let cachedToken = null;
let tokenExpiry = 0;

async function getZoomToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;
  const auth = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString("base64");

  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
    { method: "POST", headers: { Authorization: `Basic ${auth}` } }
  );

  if (!res.ok) {
    console.error("Zoom auth failed:", res.status, await res.text());
    throw new Error("zoom-auth");
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 300) * 1000; // refresh 5 min early
  return cachedToken;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const b = req.body || {};
  const firstName = String(b.firstName || "").trim().slice(0, 60);
  const lastName  = String(b.lastName  || "").trim().slice(0, 60);
  const email     = String(b.email     || "").trim().toLowerCase();
  const phone     = String(b.phone     || "").replace(/\D/g, "");
  const programme = String(b.programme || "").trim();
  const source    = String(b.source    || "landing-page").trim().slice(0, 40);

  // Same checks as the page, repeated on the server so the API can't be misused
  if (!firstName || !lastName || !programme) {
    return res.status(400).json({ error: "Please fill in every field." });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  if (phone.length < 10 || phone.length > 13) {
    return res.status(400).json({ error: "Please enter a valid phone number." });
  }

  try {
    const token = await getZoomToken();

    const type = (process.env.ZOOM_EVENT_TYPE || "webinar").toLowerCase() === "meeting"
      ? "meetings" : "webinars";
    const eventId = String(process.env.ZOOM_EVENT_ID || "").replace(/\D/g, "");

    const zoomRes = await fetch(
      `https://api.zoom.us/v2/${type}/${eventId}/registrants`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
          custom_questions: [
            { title: PROGRAM_QUESTION, value: programme },
          ],
        }),
      }
    );

    const data = await zoomRes.json().catch(() => ({}));

    if (!zoomRes.ok) {
      console.error("Zoom registration error:", zoomRes.status, data);
      return res.status(502).json({ error: "Registration failed" });
    }

    // Shows up in the Vercel function logs so you can see which channel sent them
    console.log("Registered:", { email, programme, source });

    return res.status(200).json({ ok: true, joinUrl: data.join_url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Registration failed" });
  }
};
