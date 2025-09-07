import type { VercelRequest, VercelResponse } from "@vercel/node";
import nodemailer from "nodemailer";

function env(name: string, fallback?: string) {
  const v = process.env[name];
  if (!v || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing env ${name}`);
  }
  return v;
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "mail.lendnet.io",
  port: Number(process.env.SMTP_PORT || "465"),
  secure: (process.env.SMTP_SECURE || "true") === "true",
  auth: {
    user: env("SMTP_USER"),
    pass: env("SMTP_PASS"),
  },
});

type CFAttributes = Record<string, any>;

function val(...c: any[]): string {
  for (const x of c) if (x !== undefined && x !== null && String(x).trim() !== "") return String(x);
  return "";
}

// ---- email bodies (maps to your payloads) ----
function renderLeadEmail(attrs: CFAttributes, info: any) {
  const body = [
    `Business Name: ${val(info?.business_name, attrs.business_name)}`,
    `Full Name: ${val(attrs.first_name)} ${val(attrs.last_name)}`.trim(),
    `Email: ${val(attrs.email)}`,
    `Business Phone: ${val(attrs.phone)}`,
    `Mobile Phone: `,
    ``,
    `Amount Needed: ${val(info?.answer_58915_xhsj3)}`,
    `Monthly Sales: ${val(info?.answer_58915_pisOhMKbrq)}`,
    `Time in Business: ${val(info?.answer_58915_nTAMvZ5Ii9)}`,
    `Credit Range: ${val(info?.answer_58915_hzBZCKBRoP)}`,
    `Industry: ${val(info?.answer_58915_Smg2rDp8Jy)}`,
    ``,
    `Tracking Parameters:`,
    `FB Clid: ${val(attrs.fbclid, info?.fbclid)}`,
    `Source: ${val(info?.utm_source)}`,
    `Campaign: ${val(info?.utm_campaign)}`,
    `Medium: ${val(info?.utm_medium)}`,
    `Content: ${val(info?.utm_content)}`,
    ``,
  ].join("\n");

  return {
    subject: `${env("MAIL_SUBJ_PREFIX", "[Lendnet.io]")} New Business Loan Lead`,
    text: body,
  };
}

function renderPrequalEmail(attrs: CFAttributes, info: any) {
  const r = (k: string) => val(info?.[k]);
  const body = [
    `Business Name: ${val(info?.business_name, attrs.business_name)}`,
    `Full Name: ${val(attrs.first_name)} ${val(attrs.last_name)}`.trim(),
    `Email: ${val(attrs.email)}`,
    `Business Phone: ${val(attrs.phone)}`,
    `Mobile Phone: `,
    ``,
    `Pre-Underwriting Survey Answers:`,
    `Priority: ${r("answer_88258_xhsj3")}`,
    `Timeline: ${r("answer_88258_yzA90Xu4rN")}`,
    `Franchise: ${r("answer_88258_vsx7u8gmdl")}`,
    `Use of funds: ${r("answer_88258_bSQne6Mvu8")}`,
    `Profitable: ${r("answer_88258_S2aVdEDKfJ")}`,
    `Tax liens: ${r("answer_88258_wrDsTWxWz8")}`,
    `Bankruptcy: ${r("answer_88258_9CmdGjdF79")}`,
    `BK Status: ${r("answer_88258_hcvrXeUCVm")}`,
    `BK Discharged: ${r("answer_88258_FOa4FSnEam")}`,
    `Bank accts: ${r("answer_88258_xSJXMVN7qd")}`,
    `Entity: ${r("answer_88258_NdkMRm9tFE")}`,
    `Deposits/month: ${r("answer_88258_iR4iPvp9Kz")}`,
    `NSFs/month: ${r("answer_88258_f0mbFNkDDb")}`,
    `Min daily balance: ${r("answer_88258_iNAeKr99AI")}`,
    `Negative days: ${r("answer_88258_X6GIZa4LkX")}`,
    `Paying off debt: ${r("answer_88258_qmcAEgk0TN")}`,
    `Debt type: ${r("answer_88258_kmluskg5mI")}`,
    `Loans count: ${r("answer_88258_sja81P51mR")}`,
    `Ever defaulted: ${r("answer_88258_f5C2TCIXZP")}`,
    `Ownership: ${r("answer_88258_Aee8ztqutG")}`,
    `Property: ${r("answer_88258_ALcdqdVpxa")}`,
    `Employees: ${r("answer_88258_RLanLJWhyI")}`,
    ``,
    `Tracking Parameters:`,
    `FB Clid: ${val(attrs.fbclid, info?.fbclid)}`,
    `Source: ${val(info?.utm_source)}`,
    `Campaign: ${val(info?.utm_campaign)}`,
    `Medium: ${val(info?.utm_medium)}`,
    `Content: ${val(info?.utm_content)}`,
    ``,
  ].join("\n");

  return {
    subject: `${env("MAIL_SUBJ_PREFIX", "[Lendnet.io]")} New Pre-Underwriting Survey`,
    text: body,
  };
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

    const kind = req.body?.kind as "lead" | "prequal";
    if (kind !== "lead" && kind !== "prequal") {
      return res.status(400).json({ error: "Invalid kind" });
    }

    const attrs = (req.body?.attributes ?? {}) as CFAttributes;
    const info = (req.body?.additional_info ?? {}) as Record<string, any>;

    const { subject, text } =
      kind === "lead" ? renderLeadEmail(attrs, info) : renderPrequalEmail(attrs, info);

    const mail = {
      from: env("MAIL_FROM", "Lendnet.io <sean@lendnet.io>"),
      to: TEST_MODE
        ? env("MAIL_TO_TEST", "sean@lendnet.io")
        : env("MAIL_TO_LIVE", "info@lyftcapital.com,sean@lendnet.io"),
      subject,
      text,
    };

    await transporter.sendMail(mail);
    return res.status(200).json({ ok: true, test: TEST_MODE });
  } catch (e: any) {
    console.error("Mailer error:", e?.message || e);
    return res.status(500).json({ error: "Internal error" });
  }
}
