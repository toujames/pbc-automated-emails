import { Resend } from "resend";

const PLANNING_CENTER_PEOPLE_URL = "https://api.planningcenteronline.com/people/v2/people";

const env = {
  planningCenterClientId: process.env.PC_CLIENTID,
  planningCenterSecret: process.env.PC_SECRET,
  resendApiKey: process.env.RESEND_API,
  from: process.env.EMAIL_FROM,
  replyTo: process.env.EMAIL_REPLY_TO,
  testEmail: process.env.TEST_EMAIL,
  dryRun: isTruthy(process.env.DRY_RUN),
  sendEvents: new Set((process.env.SEND_EVENTS || "birthday,anniversary").split(",").map((event) => event.trim())),
  timezone: process.env.TIME_ZONE || "America/Chicago",
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  validateConfig();

  const today = getToday(env.timezone);
  const people = await fetchPeople();
  const celebrations = findCelebrations(people, today);

  console.log(`Checked ${people.length} people for ${today.isoDate} (${env.timezone}).`);

  if (celebrations.length === 0) {
    console.log("No birthday or anniversary emails to send today.");
    return;
  }

  console.log(`Found ${celebrations.length} celebration email(s).`);

  const resend = env.dryRun ? null : new Resend(env.resendApiKey);

  for (const celebration of celebrations) {
    await sendCelebrationEmail(resend, celebration);
  }
}

function validateConfig() {
  const missing = [];

  if (!env.planningCenterClientId) missing.push("PC_CLIENTID");
  if (!env.planningCenterSecret) missing.push("PC_SECRET");
  if (!env.dryRun && !env.resendApiKey) missing.push("RESEND_API");
  if (!env.dryRun && !env.from) missing.push("EMAIL_FROM");

  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
}

async function fetchPeople() {
  const people = [];
  let nextUrl = `${PLANNING_CENTER_PEOPLE_URL}?include=emails&per_page=100`;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.planningCenterClientId}:${env.planningCenterSecret}`).toString("base64")}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Planning Center request failed (${response.status}): ${body}`);
    }

    const page = await response.json();
    const emailById = groupEmailsById(page.included || []);
    const emailByPersonId = groupEmailsByPersonId(page.included || []);

    for (const person of page.data || []) {
      const relationshipEmails = getRelationshipEmails(person, emailById);
      const fallbackEmails = emailByPersonId.get(person.id) || [];

      people.push(normalizePerson(person, relationshipEmails.length > 0 ? relationshipEmails : fallbackEmails));
    }

    nextUrl = page.links?.next || null;
  }

  return people;
}

function groupEmailsById(included) {
  const emailById = new Map();

  for (const item of included) {
    if (!isEmailResource(item)) continue;

    emailById.set(item.id, item.attributes || {});
  }

  return emailById;
}

function groupEmailsByPersonId(included) {
  const emailByPersonId = new Map();

  for (const item of included) {
    if (!isEmailResource(item)) continue;

    const personId = item.relationships?.person?.data?.id;
    if (!personId) continue;

    const emails = emailByPersonId.get(personId) || [];
    emails.push(item.attributes || {});
    emailByPersonId.set(personId, emails);
  }

  return emailByPersonId;
}

function getRelationshipEmails(person, emailById) {
  const emailRefs = person.relationships?.emails?.data || [];

  return emailRefs.map((email) => emailById.get(email.id)).filter(Boolean);
}

function isEmailResource(item) {
  return ["Email", "emails"].includes(item.type);
}

function normalizePerson(person, emails) {
  const attributes = person.attributes || {};

  return {
    id: person.id,
    firstName: attributes.first_name || attributes.given_name || attributes.name?.split(" ")[0] || "friend",
    fullName: attributes.name || [attributes.first_name, attributes.last_name].filter(Boolean).join(" "),
    birthdate: attributes.birthdate,
    anniversary: attributes.anniversary,
    status: attributes.status,
    email: chooseEmail(emails),
  };
}

function chooseEmail(emails) {
  const validEmails = emails.filter((email) => email.address);
  const primary = validEmails.find((email) => email.primary);

  return (primary || validEmails[0])?.address || null;
}

function findCelebrations(people, today) {
  const celebrations = [];

  for (const person of people) {
    if (!person.email) continue;
    if (isInactive(person.status)) continue;

    if (env.sendEvents.has("birthday") && isSameMonthDay(person.birthdate, today)) {
      celebrations.push({ type: "birthday", person });
    }

    if (env.sendEvents.has("anniversary") && isSameMonthDay(person.anniversary, today)) {
      celebrations.push({ type: "anniversary", person });
    }
  }

  return celebrations;
}

function isInactive(status) {
  return typeof status === "string" && ["inactive", "deceased"].includes(status.toLowerCase());
}

function isSameMonthDay(value, today) {
  if (!value) return false;

  const match = String(value).match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!match) return false;

  return match[1] === today.month && match[2] === today.day;
}

async function sendCelebrationEmail(resend, celebration) {
  const { person, type } = celebration;
  const subject = type === "birthday" ? "Happy birthday!" : "Happy anniversary!";
  const html = type === "birthday" ? birthdayHtml(person) : anniversaryHtml(person);
  const text = type === "birthday" ? birthdayText(person) : anniversaryText(person);
  const to = env.testEmail || person.email;

  if (env.dryRun) {
    console.log(`[dry-run] Would send ${type} email to ${person.fullName || person.firstName} <${to}>`);
    return;
  }

  const { error } = await resend.emails.send({
    from: env.from,
    to,
    replyTo: env.replyTo,
    subject,
    html,
    text,
  });

  if (error) {
    throw new Error(`Failed to send ${type} email to ${person.email}: ${JSON.stringify(error)}`);
  }

  console.log(`Sent ${type} email to ${person.fullName || person.firstName} <${to}>`);
}

function birthdayHtml(person) {
  return `
    <p>Hi ${escapeHtml(person.firstName)},</p>
    <p>Happy birthday from your PBC family. We are grateful for you and pray this year is filled with God's grace, peace, and joy.</p>
    <p>With love,<br>PBC</p>
  `.trim();
}

function birthdayText(person) {
  return [
    `Hi ${person.firstName},`,
    "",
    "Happy birthday from your PBC family. We are grateful for you and pray this year is filled with God's grace, peace, and joy.",
    "",
    "With love,",
    "PBC",
  ].join("\n");
}

function anniversaryHtml(person) {
  return `
    <p>Hi ${escapeHtml(person.firstName)},</p>
    <p>Happy anniversary from your PBC family. We are grateful for your marriage and pray God's continued blessing over the year ahead.</p>
    <p>With love,<br>PBC</p>
  `.trim();
}

function anniversaryText(person) {
  return [
    `Hi ${person.firstName},`,
    "",
    "Happy anniversary from your PBC family. We are grateful for your marriage and pray God's continued blessing over the year ahead.",
    "",
    "With love,",
    "PBC",
  ].join("\n");
}

function getToday(timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const dateParts = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    isoDate: `${dateParts.year}-${dateParts.month}-${dateParts.day}`,
    month: dateParts.month,
    day: dateParts.day,
  };
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
