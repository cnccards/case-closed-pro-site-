# Data Processing Agreement (DPA)

**⚠️ ATTORNEY REVIEW REQUIRED BEFORE USE.** This is a starting-point draft
modeled on common SaaS DPA structure. DPAs are heavily standardized in
practice (most enterprise buyers expect GDPR-style structure even for
non-EU deals) but the specific commitments here — sub-processor list,
breach notification window, audit rights, data deletion timelines — must
be reviewed against your actual infrastructure and negotiated per customer.
Do not send this to a prospective enterprise customer without counsel
sign-off.

_Last updated: [DATE]_

---

This Data Processing Agreement ("**DPA**") supplements the Terms of Service
(the "**Agreement**") between [COMPANY LEGAL NAME] ("**Processor**," "**we**")
and the customer Organization identified in the applicable order form or
account registration ("**Controller**," "**you**"), and applies to the
extent we process personal data on your behalf in connection with the
Service. Capitalized terms not defined here have the meaning given in the
Agreement.

## 1. Roles of the Parties

You are the Controller (or, where you act as a service provider/processor
to your own carrier or firm clients, a Processor) with respect to Customer
Data containing personal data, including claimant information. We are a
Processor (or sub-processor, as applicable) acting only on your
instructions as set out in the Agreement and this DPA.

## 2. Scope and Nature of Processing

**2.1 Subject matter.** Our provision of the Service, including hosting,
storage, and processing of Customer Data you submit.

**2.2 Duration.** For the term of the Agreement, plus any post-termination
retention period described in Section 8.

**2.3 Nature and purpose.** Storing, organizing, retrieving, transmitting,
and displaying Customer Data as necessary to provide litigation case
management, reporting, and related features you configure and use.

**2.4 Categories of data subjects.** Claimants and other individuals
referenced in matter records (e.g., witnesses, medical providers, lien
holders); your Users (adjusters, attorneys, staff) accessing the Service.

**2.5 Categories of personal data.** Contact information; case and claim
details; where applicable, information relating to physical injury or
medical treatment in connection with liens and settlements; financial
information related to claims (reserves, settlement amounts).

_[Flag for counsel: injury/medical information in this context may warrant
treatment as a "special category" / sensitive data classification under
some privacy frameworks even though this is not a healthcare product —
confirm the right classification and any resulting additional safeguards.]_

## 3. Processor Obligations

We will:

**3.1** Process Customer Data only on your documented instructions
(including as set out in the Agreement), unless required to do otherwise by
law, in which case we will notify you before processing unless legally
prohibited from doing so.

**3.2** Ensure personnel authorized to process Customer Data are subject to
confidentiality obligations.

**3.3** Implement appropriate technical and organizational security
measures, including [encryption in transit; role-based access control;
audit logging; multi-tenant data isolation as described in our security
overview — confirm this list against what's actually implemented].

**3.4** Not engage a new sub-processor without providing you notice and a
reasonable opportunity to object, per Section 5.

**3.5** Assist you, taking into account the nature of the processing, in
responding to data subject requests and in meeting your obligations
regarding security, breach notification, and data protection impact
assessments, to the extent required by applicable law.

**3.6** Notify you without undue delay, and in any event within
[48/72] hours of becoming aware, of any breach involving Customer Data.

**3.7** At your written request, and no more than once per [12-month]
period absent a security incident, make available information reasonably
necessary to demonstrate compliance with this DPA, and permit and
contribute to audits, including inspections, conducted by you or an
auditor you designate, subject to reasonable confidentiality and scheduling
conditions.

**3.8** At your election, delete or return all Customer Data upon
termination of the Agreement, subject to Section 8.

## 4. Controller Obligations

You represent that: (a) you have all necessary rights and legal basis to
submit Customer Data to the Service and to instruct us to process it as
contemplated by the Agreement; (b) your instructions to us comply with
applicable law; and (c) where you grant a defense-firm Organization access
to specific matters, you are responsible for the appropriateness of that
access grant.

## 5. Sub-processors

**5.1 General authorization.** You provide general authorization for us to
engage sub-processors to provide the Service, subject to the obligations in
this Section.

**5.2 Current sub-processors.** A current list of sub-processors is
available at [stable URL — maintain this separately from the DPA text
itself so it can be updated without re-executing the agreement]. As of this
draft, categories include: cloud hosting/database infrastructure, email
delivery, payment processing (Stripe), and AI processing (Anthropic).

**5.3 Notice of changes.** We will provide notice of new sub-processors
[via the sub-processor list page with a change log, or via email] at least
[10] days before granting them access to Customer Data, and you may object
on reasonable data-protection grounds within that period.

**5.4 Flow-down.** We will impose data protection obligations on
sub-processors that are no less protective than those in this DPA.

## 6. International Transfers

_[If Customer Data may be transferred outside the customer's home
jurisdiction — e.g., US hosting for a customer with EU-connected
claimants — counsel needs to add appropriate transfer mechanism language
here (SCCs, adequacy, etc.). Do not leave this section blank if there is
any realistic cross-border fact pattern.]_

## 7. Security Incident Response

Upon confirming a security incident affecting Customer Data, we will: (a)
notify you per Section 3.6; (b) provide information reasonably available to
us about the nature and scope of the incident as it becomes known; (c)
take reasonable steps to mitigate the effects and minimize damage; and
(d) reasonably cooperate with your investigation, subject to a mutually
agreed confidentiality approach for sensitive technical details.

## 8. Data Return and Deletion

Within [30] days of termination of the Agreement, and upon your written
request, we will make Customer Data available for export in a standard
format (e.g., JSON/CSV export via the API). Following the export window (or
immediately upon request if no export is needed), we will delete Customer
Data from active systems within [30/60] additional days, except: (a) copies
retained in backups will be deleted per our standard backup rotation
schedule (not to exceed [90] days); and (b) we may retain data as required
by law or for legitimate business purposes such as fraud prevention and
dispute resolution, limited to what is necessary for those purposes.

## 9. Liability

Liability under this DPA is subject to the limitations of liability set out
in the Agreement, except where applicable law prohibits limiting liability
for data protection violations.

## 10. Term

This DPA takes effect when the Agreement takes effect and terminates
automatically upon termination of the Agreement, except that obligations
which by their nature should survive (confidentiality, post-termination
deletion) will survive.

## 11. Order of Precedence

In the event of a conflict between this DPA and the Agreement regarding the
processing of personal data, this DPA controls.

---

**Signature blocks / incorporation by reference language to be added by
counsel**, depending on whether this is executed as a standalone document
or incorporated by reference into the Terms of Service via a checkbox/
click-through at signup.
