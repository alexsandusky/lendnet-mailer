// /api/send.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import nodemailer from "nodemailer";

function env(name: string, fallback?: string) {
  const v = process.env[name];
  if (v == null || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing env ${name}`);
  }
  return v;
}

const DEBUG = (process.env.DEBUG_MAILER || "false") === "true";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "mail.lendnet.io",
  port: Number(process.env.SMTP_PORT || "465"),
  secure: (process.env.SMTP_SECURE || "true") === "true",
  auth: {
    user: env("SMTP_USER"),
    pass: env("SMTP_PASS"),
  },
});

type AnyObj = Record<string, any>;
const val = (...c: any[]): string => {
  for (const x of c) if (x !== undefined && x !== null && String(x).trim() !== "") return String(x);
  return "";
};

/** -------- Normalize CF payload like the Worker does -------- */
function normalize(body: AnyObj) {
  // CF often posts { contact:{...}, event:{...} } and sometimes { attributes } / { payload }
  const contact = body?.contact || {};
  const event = body?.event || {};
  const attrs = body?.attributes || body?.payload || {};
  const profile = contact.contact_profile || event.contact_profile || attrs.contact_profile || {};

  // Flatten to "a"
  const a: AnyObj = { ...contact, ...event, ...attrs, contact_profile: profile };

  // Where CF hides Q&A and UTMs the most
  const add: AnyObj =
    contact.additional_info ||
    event.additional_info ||
    attrs.additional_info ||
    body?.additional_info ||
    {};

  // PreQual detector (same as Worker)
  const addKeys = Object.keys(add || {});
  const isPreQual = addKeys.some((k) => k.startsWith("answer_88258_"));

  return { a, add, isPreQual };
}

/** -------- Email bodies (match Worker text exactly) -------- */
function buildLeadText(a: AnyObj, add: AnyObj) {
  const bizPhone = a.vat_number || a.phone || a.contact_profile?.phone || "";
  return [
    "Business Name: " + (a.business_name || add.business_name || ""),
    "Full Name: " +
      [a.first_name || a.contact_profile?.first_name, a.last_name || a.contact_profile?.last_name]
        .filter(Boolean)
        .join(" "),
    "Email: " + (a.email || a.contact_profile?.email || ""),
    "Business Phone: " + bizPhone,
    "Mobile Phone: " + (a.phone || a.contact_profile?.phone || ""),
    "",
    "Amount Needed: " + (add.answer_58915_xhsj3 || ""),
    "Monthly Sales: " + (add.answer_58915_pisOhMKbrq || ""),
    "Time in Business: " + (add.answer_58915_nTAMvZ5Ii9 || ""),
    "Credit Range: " + (add.answer_58915_hzBZCKBRoP || ""),
    "Industry: " + (add.answer_58915_Smg2rDp8Jy || ""),
    "",
    "Tracking Parameters:",
    "FB Clid: " + (a.fbclid || add.fbclid || ""),
    "Source: " + (a.utm_source || add.utm_source || ""),
    "Campaign: " + (a.utm_campaign || add.utm_campaign || ""),
    "Medium: " + (a.utm_medium || add.utm_medium || ""),
    "Content: " + (a.utm_content || add.utm_content || ""),
    "",
  ].join("\n");
}

function buildPrequalText(a: AnyObj, add: AnyObj) {
  const L = (label: string, v: any) => `${label}: ${v || ""}`;
  const bizPhone = a.vat_number || a.phone || a.contact_profile?.phone || "";
  return [
    "Business Name: " + (a.business_name || add.business_name || ""),
    "Full Name: " +
      [a.first_name || a.contact_profile?.first_name, a.last_name || a.contact_profile?.last_name]
        .filter(Boolean)
        .join(" "),
    "Email: " + (a.email || a.contact_profile?.email || ""),
    "Business Phone: " + bizPhone,
    "Mobile Phone: " + (a.phone || a.contact_profile?.phone || ""),
    "",
    "Pre-Underwriting Survey Answers:",
    L("Priority", add.answer_88258_xhsj3),
    L("Timeline", add.answer_88258_yzA90Xu4rN),
    L("Franchise", add.answer_88258_vsx7u8gmdl),
    L("Use of funds", add.answer_88258_bSQne6Mvu8),
    L("Profitable", add.answer_88258_S2aVdEDKfJ),
    L("Tax liens", add.answer_88258_wrDsTWxWz8),
    L("Bankruptcy", add.answer_88258_9CmdGjdF79),
    L("BK Status", add.answer_88258_hcvrXeUCVm),
    L("BK Discharged", add.answer_88258_FOa4FSnEam),
    L("Bank accts", add.answer_88258_xSJXMVN7qd),
    L("Entity", add.answer_88258_NdkMRm9tFE),
    L("Deposits/month", add.answer_88258_iR4iPvp9Kz),
    L("NSFs/month", add.answer_88258_f0mbFNkDDb),
    L("Min daily balance", add.answer_88258_iNAeKr99AI),
    L("Negative days", add.answer_88258_X6GIZa4LkX),
    L("Paying off debt", add.answer_88258_qmcAEgk0TN),
    L("Debt type", add.answer_88258_kmluskg5mI),
    L("Loans count", add.answer_88258_sja81P51mR),
    L("Ever defaulted", add.answer_88258_f5C2TCIXZP),
    L("Ownership", add.answer_88258_Aee8ztqutG),
    L("Property", add.answer_88258_ALcdqdVpxa),
    L("Employees", add.answer_88258_RLanLJWhyI),
    "",
    "Tracking Parameters:",
    L("FB Clid", a.fbclid || add.fbclid),
    L("Source", a.utm_source || add.utm_source),
    L("Campaign", a.utm_campaign || add.utm_campaign),
    L("Medium", a.utm_medium || add.utm_medium),
    L("Content", a.utm_content || add.utm_content),
    "",
  ].join("\n");
}

/** -------- Helper: parse comma/space separated recipients safely -------- */
function splitList(v?: string): string[] {
  return (v || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(200).send("ok");

    const token = (req.query.token as string) || (req.body?.token as string);
    if (!token || token !== env("BRIDGE_TOKEN")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const TEST_MODE =
      (process.env.TEST_MODE || "false") === "true" ||
      req.query.test === "1" ||
      !!req.body?.test;

    const kind = (req.body?.kind as "lead" | "prequal") || "";
    if (kind !== "lead" && kind !== "prequal") {
      return res.status(400).json({ error: "Invalid kind" });
    }

    // Normalize body into a + add (matches Worker)
    const { a, add, isPreQual } = normalize(req.body || {});

    // Build subject/text like Worker
    const subject =
      (process.env.MAIL_SUBJ_PREFIX || "[Lendnet.io]") +
      (isPreQual || kind === "prequal"
        ? " New Pre-Underwriting Survey"
        : " New Business Loan Lead");

    const text =
      isPreQual || kind === "prequal" ? buildPrequalText(a, add) : buildLeadText(a, add);

    // Sender + Reply-To (customizable)
    const from = env("MAIL_FROM", "Lendnet.io <notify@lendnet.io>");
    const replyTo = env("MAIL_REPLY_TO", "sean@lendnet.io");

    // Recipients
    const to = TEST_MODE
      ? splitList(env("MAIL_TO_TEST", "sean@lendnet.io"))
      : splitList(env("MAIL_TO_LIVE", "info@lyftcapital.com"));

    // CC only in live mode (defaults to you)
    const cc = TEST_MODE ? [] : splitList(env("MAIL_CC_LIVE", "sean@lendnet.io"));

    const mail = {
      from,
      to,
      cc: cc.length ? cc : undefined,
      replyTo,
      subject,
      text,
    };

    if (DEBUG) {
      const peek = {
        kind,
        test: TEST_MODE,
        from,
        to,
        cc,
        replyTo,
        a_keys: Object.keys(a || {}),
        add_keys: Object.keys(add || {}),
        subjLen: subject.length,
        textLen: text.length,
      };
      console.log("[VERCEL MAILER] IN:", JSON.stringify(peek));
    }

    const info = await transporter.sendMail(mail);

    if (DEBUG) {
      console.log("[VERCEL MAILER] SENT:", {
        messageId: info?.messageId,
        accepted: info?.accepted,
        rejected: info?.rejected,
        response: info?.response,
      });
    }

    return res
      .status(200)
      .json({ ok: true, test: TEST_MODE, kind, sent: { to, cc }, messageId: info?.messageId });
  } catch (e: any) {
    console.error("[VERCEL MAILER] ERROR:", e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
