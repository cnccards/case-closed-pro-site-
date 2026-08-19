# Privacy Policy

**⚠️ ATTORNEY REVIEW REQUIRED BEFORE USE.** This draft has not been reviewed
by a lawyer. Because the Service processes claimant PII and medical/injury
information (via liens), you likely have obligations under state privacy
laws (e.g., CCPA/CPRA if you have California users or claimants), and
potentially HIPAA-adjacent obligations depending on how medical information
flows through the platform — discuss this specifically with counsel, as it
affects whether you need a Business Associate Agreement structure rather
than (or in addition to) a standard DPA. Bracketed items need your specific
information.

_Last updated: [DATE]_

---

## 1. Scope

This Privacy Policy describes how [COMPANY LEGAL NAME] ("**we**," "**us**")
collects, uses, and discloses information in connection with the Case
Closed Pro platform (the "**Service**"). It covers two different kinds of
information, treated differently below:

- **Account & Usage Information** — information about the Users who access
  the Service (carrier/TPA staff, defense counsel).
- **Customer Data** — the case, claimant, and matter information our
  customers (carriers, TPAs, and defense firms) submit to the Service in
  the course of using it. We process Customer Data on our customers'
  behalf and instructions; our customers, not us, determine what Customer
  Data is collected and why. If you are a claimant or other individual
  whose information appears in Customer Data, please direct privacy
  requests to the carrier or firm handling your matter, not to us directly
  — see Section 6.

## 2. Account & Usage Information We Collect

- **Registration information**: name, work email, organization name,
  persona (carrier or defense counsel), and password (stored as a bcrypt
  hash — we never store or have access to your plain-text password).
- **Usage information**: log-in timestamps, IP address, pages/features
  accessed, and similar diagnostic information.
- **Communications**: if you contact us for support, we retain that
  correspondence.
- **Billing information**: for carrier Organizations, payment is processed
  by Stripe, Inc.; we retain limited billing metadata (plan tier,
  subscription status) but do not store full payment card numbers
  ourselves.

## 3. How We Use Account & Usage Information

- To provide, maintain, and secure the Service.
- To authenticate Users and enforce access controls between Organizations.
- To communicate with you about the Service, including security notices.
- To monitor for abuse, fraud, and violations of our Terms of Service.
- To improve the Service, including aggregated/de-identified analysis of
  usage patterns.

We do not sell Account & Usage Information, and we do not use it to serve
third-party advertising.

## 4. Customer Data

**4.1 Our role.** With respect to Customer Data, we act as a data
processor/service provider on behalf of our customers (the carrier, TPA, or
firm Organization), not as the party that decides what data to collect or
why. Our processing of Customer Data is governed by our agreement with that
customer, including any Data Processing Agreement in place — see
`data-processing-agreement.md`.

**4.2 What Customer Data may include.** Depending on how a customer uses
the Service, Customer Data may include claimant names and contact
information, case and claim details, medical/injury information relevant to
liens and settlements, financial information (reserves, settlement amounts,
billing), and documents uploaded to the platform.

**4.3 AI features.** Where a customer uses AI-generated report insights or
closing summaries, the underlying case data necessary to generate that
output is sent to our AI provider (Anthropic) for processing. [Confirm and
disclose Anthropic's data retention/training policy for API usage — as of
this draft, Anthropic's standard API terms do not train on customer data
sent via the API, but this should be verified against current terms before
publishing.] We do not use Customer Data to train our own models.

**4.4 Sub-processors.** We use the following categories of sub-processors
to provide the Service: cloud hosting/database infrastructure, email
delivery (for report-sharing and notifications), payment processing
(Stripe), and AI processing (Anthropic). [Maintain a current, specific list
at a stable URL and reference it here, since customers with DPAs will
expect to be notified of sub-processor changes.]

## 5. How We Share Information

We do not sell personal information. We share information only:

- **Within an Organization**, per the access model described in our Terms
  (carrier Users see their Organization's matters; defense-firm Users see
  only matters explicitly shared with their firm).
- **With service providers** (sub-processors, above) who process
  information on our behalf under contractual confidentiality and security
  obligations.
- **For legal reasons**, if required by law, subpoena, or other legal
  process, or to protect the rights, property, or safety of our users or
  the public.
- **In a business transfer**, if we are involved in a merger, acquisition,
  or asset sale — we will provide notice before information is transferred
  and becomes subject to a different privacy policy.

## 6. Individuals Who Are Not Our Direct Users (Claimants)

If your name or information appears in Customer Data because you are a
party to, or otherwise connected with, a litigated insurance claim, we are
processing that information on behalf of the carrier, TPA, or law firm
handling your matter — not on our own behalf. Please direct any privacy
questions or requests (access, correction, deletion) to that organization
directly. We will support our customers in responding to such requests as
required by our agreement with them and applicable law.

## 7. Your Rights

Depending on your location, you may have rights to access, correct, delete,
or restrict processing of your personal information, and to receive a copy
of it in a portable format. Account Users (not claimants — see Section 6)
can exercise these rights for their own Account & Usage Information by
contacting [privacy email]. We will respond within the time required by
applicable law.

_[This section needs jurisdiction-specific detail — e.g., explicit CCPA/CPRA
language and a "Do Not Sell or Share" mechanism if you have California
users, GDPR language if you have EU/UK users or process EU/UK claimant
data, etc. Have counsel confirm which regimes apply to your actual customer
base.]_

## 8. Data Retention

We retain Account & Usage Information for as long as an account is active
and for a reasonable period afterward for legal, security, and backup
purposes. We retain Customer Data per the retention terms in our agreement
with the applicable customer Organization, and generally delete or
anonymize it within [30/60/90] days of a customer's account termination,
except where longer retention is required by law or agreed in writing.

## 9. Security

We use industry-standard safeguards, including encryption in transit
(TLS) [and at rest — confirm this is actually implemented before stating
it], role-based access controls, and audit logging, to protect information
processed by the Service. No system is completely secure, and we cannot
guarantee absolute security.

## 10. Children's Privacy

The Service is intended for business use by adults working in insurance
claims and legal defense. It is not directed to individuals under 18, and
we do not knowingly collect Account & Usage Information from children.

## 11. Changes to This Policy

We may update this Privacy Policy from time to time. Material changes will
be communicated by [email notice / in-app notice] prior to taking effect.

## 12. Contact Us

[COMPANY LEGAL NAME]
[ADDRESS]
Privacy inquiries: [privacy email]
