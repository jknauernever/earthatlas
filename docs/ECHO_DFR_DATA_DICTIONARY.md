# ECHO Detailed Facility Report — data dictionary (reference copy)

Verbatim text of https://echo.epa.gov/help/reports/dfr-data-dictionary, fetched 2026-10-06
(US EPA, public domain), converted to Markdown for offline reference. Field meanings here
are authoritative for anything we store from `dfr_rest_services.get_dfr`; see
docs/PERMITS_SOURCES.md. Re-fetch before relying on it after EPA changes the DFR.

### Important Notes

Consider the following as you evaluate the data:

- The Detailed Facility Report is an aggregate report; therefore, some data are displayed differently due to differences in tracking methods and indicators used in the source databases.
- Each facility may not have data for every report section. If no relevant data exist for a given report section, a note is displayed explaining that no information exists for a facility.
- Compliance and enforcement data are separate from other environmental information which is included to provide context for analyses (e.g., chemical release and demographic data).
- The age of the data presented varies and is dependent on when data were last updated from the source database. The dates of the last updates made in ECHO are shown in About the Data.
- EPA and/or the state agencies that report data to EPA have identified some broad-scale data issues that may impact the completeness, timeliness, or accuracy of data shown in ECHO. These issues are described on the Known Data Problems page.
- Date ranges referenced in the Detailed Facility Report are defined as follows:Month – Any calendar month from January-December.
- Quarter – Any of the following three-month periods: January-March, April-June, July-September, or October-December.
- Last Three Years – The twelve most recently completed quarters, plus data from the current quarter up until the refresh date.
- Last Five Years – The twenty most recently completed quarters, plus data from the current quarter up until the refresh date.
- Violation identified, noncompliance, significant noncompliance, significant noncomplier, enforcement priority, and high priority violation are all terms used by the ECHO website to describe the facility’s history in regard to compliance with the law. In many cases, these terms reflect determinations made by EPA or states when conducting inspections or reviewing facility self-reports. These determinations assist the government in tracking resolution of violations through the enforcement process and do not necessarily represent a final adjudication by a judicial or administrative body. In such cases, these characterizations should be considered alleged violations. Additional information on how to interpret a facility’s compliance status is available on ECHO’s Frequently Asked Questions page.
- The duration of violations shown on this report is an estimate of the actual duration of the violations that might be alleged or later determined in a legal proceeding. For example, the start date of the violation as shown in the ECHO database is normally when the government first became aware of the violation, not the first date that the violation occurred, and the facility may have corrected the violation before the end date shown. In some situations, violations may have been corrected by the facility, but EPA or the State has not verified the correction of these violations. In other situations, EPA does not remove the violation flag until an enforcement action has been resolved.
- ECHO includes data from the following national program databases:Facility Registry Service (FRS)
- ICIS-Air
- Integrated Compliance Information System (ICIS) Federal Enforcement and Compliance (FE&C) for the following environmental laws:American Innovation and Manufacturing Act (AIM)
- Clean Air Act (CAA)
- Clean Water Act (CWA)
- Resource Conservation and Recovery Act (RCRA)
- Safe Drinking Water Act (SDWA)
- Comprehensive Environmental Response, Compensation and Liability Act (CERCLA)
- Emergency Planning and Community Right-to-Know Act (EPCRA)
- Federal Insecticide, Fungicide, and Rodenticide Act (FIFRA)
- Marine Protection, Research, and Sanctuaries Act (MPRSA)
- Toxic Substances Control Act (TSCA)
- ICIS National Pollutant Discharge Elimination System (ICIS-NPDES)
- Resource Conservation and Recovery Act Information (RCRAInfo) System
- Safe Drinking Water Information System (SDWIS)
- Toxics Release Inventory (TRI) Data
- Emission Inventory System (EIS) Database
- Greenhouse Gas Reporting Program (GHG)
- Clean Air Markets Division Business System (CAMDBS)
- Assessment, TMDL Tracking, and ImplementatioN System (ATTAINS)
- BEach Advisory and Closing Online Notification (BEACON)
- US Census Data

### Customize Report

The report is customizable using toggles available in the Customize Report section:

- Environmental Media - Select an environmental media (Air, Water, Hazardous Waste, or Drinking Water) to filter the information on the report to one statute. The default view displays data for all statutes.Top of Page

### Facility Summary

This section presents a general, high-level summary of the selected facility, including a map of the facility location, basic facility identification information, regulatory interests (e.g., facility permits and other program identifiers), and a snap-shot of the facility's most recent enforcement and compliance record.

Map

Location of the facility based on latitude/longitude coordinates displayed on a map. Other nearby facilities also will display. Only those facilities with available geographical data are mapped. The symbols used are described in detail below:

Stripe color corresponds to the statute under which the facility is regulated.              Multimedia (multiple statutes)              Resource Conservation and Recovery Act (RCRA)              Clean Water Act (CWA)              Safe Drinking Water Act (SDWA)              Clean Air Act (CAA)              None of the above (Facility Registry Service (FRS)-only facility)

Body color corresponds to compliance status of the facility.              Significant Violation              No Violations Identified in Database              Violation Identified              Compliance Information Unavailable or Unknown              Inactive Facility or System 

Icon numbering corresponds to the number of years since the facility was last inspected.                           Longer than 5 years              Never inspected

Icon size differentiates between major and minor facilities.              Minor facility              Major facility

 Represents a facility with approximated latitude/longitude coordinates. The location is the centroid of the facility's ZIP code.

Top of Page

#### Facility Information

Facility Information included in this section is associated with a particular FRS ID. FRS links together all regulatory program database records (such as permit IDs and facility IDs that facilities use in reporting to EPA).

Facility Name

Company or permit holder name, as maintained in FRS. The facility name may differ across EPA databases due to differences in reported information, change in ownership, use of parent or subsidiary name, etc.

Facility Address

Street address, city, state, and zip code where facility is located, as maintained in FRS. Certain data systems also maintain mailing address information, which is not used in this report. The street address may differ across EPA databases due to differences in reported information (e.g., use of mailing address), change in ownership, use of parent or subsidiary address, etc.

FRS ID

The identification number that is assigned to a facility by FRS to uniquely identify a facility site.

EPA Region

The EPA region where the facility is located. EPA has 10 regional offices that execute programs within several states and territories.

Latitude/Longitude

The facility or permit holder's latitude and longitude coordinates (NAD83 coordinate system).

Locational Data Source

The source database of the facility's latitude and longitude location data. Coordinates from FRS are typically shown. If the coordinates are unavailable through FRS, the program system locational data are shown (converted to NAD83 as needed).

Industry

The description of the first 3 digits of the 6-digit NAICS code associated with the facility. NAICS codes may differ between program data systems, so the NAICS description is chosen from one data system in the following preferential order: TRI, GHG, ICIS-Air, RCRAInfo, ICIS-NPDES. If no NAICS code exists, the SIC code description is displayed. This field may be blank if there are no NAICS or SIC codes associated with the facility. See the Facility/System Characteristics section to view additional Standard Industrial Classification (SIC) codes and North American Industry Classification System (NAICS) codes associated with the facility.

Indian Country

A value of "Y" indicates the facility is in Indian country, while "N" indicates the facility is not in Indian country. ECHO derives this field based on FRS and ICIS. The ICIS value is used if the FRS value is null. A value of "N/A" (Not Available) or null indicates this information is not maintained in either program data system.

Indian country is defined by statute at 18 U.S.C. 1151 and includes all lands within Indian reservations, dependent Indian communities, and allotted lands.

#### Enforcement and Compliance Summary Table

#### Key Terms

Violation identified, noncompliance, significant noncompliance, significant noncomplier, enforcement priority, and high priority violation are all terms used by the ECHO website to describe the facility’s history in regard to compliance with the law. In many cases, these terms reflect determinations made by EPA or states when conducting inspections or reviewing facility self-reports. These determinations assist the government in tracking resolution of violations through the enforcement process and do not necessarily represent a final adjudication by a judicial or administrative body. In such cases, these characterizations should be considered alleged violations. Additional information on how to interpret a facility’s compliance status is available on ECHO’s Frequently Asked Questions page.

Statute

Identifies the environmental statute associated with each of the permits and identifiers linked to the facility:

- AIM — American Innovation and Manufacturing Act
- CAA — Clean Air Act
- CWA — Clean Water Act
- EPCRA — Emergency Planning and Community Right-to-Know Act, Section 313 (i.e., the Toxics Release Inventory (TRI) program)
- FIFRA — Federal Insecticide, Fungicide, and Rodenticide Act
- RCRA — Resource Conservation and Recovery Act
- SDWA — Safe Drinking Water Act
- TSCA — Toxic Substances Control Act

Compliance Monitoring Activities (5 years)

The number of compliance monitoring activities, under the corresponding statute, occurring at the facility within the last five years. This count only includes activities included in official counts. See Compliance Monitoring History for a list of activity types counted.

Date of Last Compliance Monitoring Activity

The date on which the most recent compliance monitoring activity of the facility took place. For the Clean Air Act, the date on which a Full Compliance Evaluation (FCE) was completed. This date may or may not correspond to an actual site visit. A series of partial on- or off-site inspections may have been conducted during the fiscal year as part of an FCE.

Compliance Status

Displays an indication of the most recent compliance status for each statute under which the facility is regulated. The date of the information reflecting the most recent status is listed in the "Data Last Refreshed" date in the Compliance Summary Data table.

Status codes include:

- No Violation Identified – Blue
- Noncompliance/Violation Identified - Yellow-orange
- High Priority Violation (CAA), Significant/Category I Noncompliance (CWA), Significant Noncomplier (RCRA), Enforcement Priority (SDWA) – Red
- No Information/In Progress/Unknown/Not Available - Gray
- Inactive (SDWA)/Not Applicable (CWA)/Terminated Permit (CWA) - no cell shading

Quarters with Noncompliance (Qtrs with NC) (of 12)

Count of the number of quarters, out of the last twelve official quarters and the 13th unofficial quarter*, in which the permit or site is considered either with violations identified, in Noncompliance (NC) status, in Significant Noncompliance (SNC), or High Priority Violation (HPV) status. Additional information on how to interpret compliance status information can be found on ECHO's Frequently Asked Questions page.

* In the event that all thirteen quarters have violations, Qtrs with NC will display "12" and not count the 13th unofficial quarter.

Quarters (Qtrs) with Significant Violation

The number of quarters (of 12) with significant violations by statute. Additional information on how to interpret compliance status information can be found on ECHO's Frequently Asked Questions page.

Informal Enforcement Actions 

The number of informal enforcement actions taken against the facility, under the corresponding statute, within the last five or ten years, with five being the default.

Formal Enforcement Actions 

The number of formal enforcement actions taken against the facility, under the corresponding statute, within the last five or ten years, with five being the default. This count only includes enforcement actions that have been entered in the national program databases: ICIS-Air, ICIS-NPDES, and RCRAInfo. Federal CAA and RCRA enforcement actions that have been entered into ICIS are not included in this section to avoid duplicative counting. (Please note that all actions at NPDES facilities in states using ICIS-NPDES are counted.) Please refer to the Formal Enforcement Actions section to determine which actions qualify.

Penalties from Formal Enforcement Actions (5 years)

The total dollar amount of either assessed or final penalties resulting from formal enforcement actions. This count only includes penalties that have been entered in the national program databases: ICIS-Air, ICIS-NPDES, and RCRAInfo. Refer to the Formal Enforcement Actions table for more information.

EPA Cases (5 years)

The number of EPA enforcement cases in ICIS FE&C. Refer to the Formal Enforcement Actions table for more information.

Penalties from EPA Cases (5 years)

The total dollar amount of either assessed (or final) penalties. This count only includes penalties that have been entered in the national program databases: ICIS-Air, ICIS-NPDES, and RCRAInfo. Federal CAA and RCRA penalties that have been entered into ICIS Federal Enforcement and Compliance are not included in this section to avoid duplicative counting. This count does not include proposed penalties in RCRAInfo or the cost of Supplemental Environmental Projects (SEPs).

#### Related Reports

If the facility has any reports available in ECHO, the Related Reports section will display hyperlinks to each available reports. If multiple reports are available for a particular report type, selecting the report hyperlink will open an overlay window with hyperlinks to available reports.

Facility Documents

A separate webpage providing links to download available enforcement and compliance documents. The types of documents and date ranges available may differ between facilities.

View Envirofacts Reports

Provides links to EPA's Envirofacts website for additional information related to FRS, NPDES permits, and TRI facility and pollution prevention information. Note that by navigating to Envirofacts, the user will leave the ECHO website.

#### Regulatory Information

For each of the following four environmental laws, displays key identification information for the facility where applicable:

- Clean Air Act: Facility activity and operating status (e.g., Operating Major)
- Clean Water Act: Major/non-major status, permit status and NPDES Permit ID(s) (e.g., Major, Permit Effective (DC0000019, DC0000018))
- Safe Drinking Water Act: Owner, Primary water source type, system type, facility activity status, and SDWA ID (e.g., OWNER: Private SOURCE: Ground water TYPE: Community water system, Permit Active (CA1000267))
- Resource Conservation and Recovery Act: Facility activity status and type (e.g., Active Small Quantity Generator)

#### Other Regulatory Reports

Where applicable, displays information about related environmental emission reporting programs, including hyperlinks to other data system reports, including:

- Air Emissions Inventory (EIS): The Emissions Inventory System contains information on stationary and mobile sources that emit criteria air pollutants and their precursors, as well as hazardous air pollutants (HAPs). The database includes estimates of emissions, by source, of air pollutants in each area of the country, on an annual basis.
- Greenhouse Gas Emissions (eGGRT): Links to the facility report for the most recent available reporting year in EPA's Facility Level Information on Greenhouse Gases Tool (FLIGHT).
- Toxic Releases (TRI): Lists all TRI IDs associated with the facility.
- Benzene Fenceline Monitoring (BFLM) Dashboard: A blue "F" icon links to the BFLM dashboard for each CEDRI ID with BFLM data.Top of Page

### Facility/System Characteristics

This section provides additional detailed facility identification information that is tracked in EPA's Facility Registry Service (FRS), including: geographic location information, program-specific facility ID numbers, permit IDs and related status information, standard industrial classification code(s), etc.

#### Facility/System Characteristics Table

System

The data source associated with the facility information.

| Acronym | Data System |
|---|---|
| ICIS-Air | ICIS-Air |
| EIS | Emissions Inventory System, provided through FRS |
| FRS | Facility Registry Services |
| GHG | Greenhouse Gas Emissions, provided through FRS |
| ICIS-NPDES | ICIS National Pollutant Discharge Elimination System (ICIS-NPDES) |
| RCRAInfo | Resource Conservation and Recovery Act Information System (RCRAInfo) |
| RMP | Clean Air Act Risk Management Plan Program, provided through FRS |
| SDWIS | Safe Drinking Water Information System |
| SEMS | Superfund Enterprise Management System, provided through FRS |
| TRI | Toxics Release Inventory, provided through FRS |
| TSCA | Toxic Substances Control Act, provided through FRS |

Statute 

Identifies the environmental statute associated with each of the permits and identifiers linked to the facility. Only CAA, CWA, RCRA, and EP313 are displayed in this section. The first row of this table is typically FRS data, which are not associated with a particular statute.

- CAA — Clean Air Act
- CERCLA — Comprehensive Environmental Response, Compensation, and Liability Act (Superfund)
- CWA — Clean Water Act
- RCRA — Resource Conservation and Recovery Act
- SDWA — Safe Drinking Water Act
- EP313 — Emergency Planning and Community Right-to-Know Act, Section 313 (i.e., the Toxics Release Inventory (TRI) program)
- TSCA - Toxic Substances Control Act
- RMP - Risk Management Plan Rule
- CAMD - Clean Air Markets Division

Identifier

An alphanumeric field that displays the source database abbreviation and the unique value assigned for each record/permit/site within the source system. These identifiers generally are for database tracking purposes. The identifier used in the federal database may be different from any permit number issued to the facility. 

In this section, some IDs are hyperlinked to EPA reports outside the ECHO website. FRS IDs link to the EPA Envirofacts FRS Facility Detail Report. Where applicable, SEMS IDs link to the EPA Superfund Site profile report. GHGRP IDs link to the EPA GHG Summary Report for the facility.

Universe

This field provides further description on type of permit or record for each data system as follows. Read ECHO's Guide to Regulated Facilities for more information about the types of facilities tracked in EPA's data systems.

CAA - The plant-level classification of a source's emission status. ECHO displays the highest emission level classification across active Air programs and pollutants regulated. Emission status may include: Major Emissions, 80% Synthetic Minor Emissions, Synthetic Minor Emissions, Minor Emissions, Classification Unknown, Other, or Not Applicable. Who has to obtain a Title V permit?             The program office defines each CAA Source ID and the associated permits as being Federally Reportable or Non-Federally Reportable. Under the CAA, federally reportable sources include Title V Majors, Synthetic Minors (sources that voluntarily agree to an enforceable permit restriction to limit emissions below the major source threshold), sources subject to the 40 CFR Part 61 (NESHAP) regulation, any facility where a High Priority Violation has been identified, sources subject to formal enforcement, or included on a Compliance Monitoring Strategy plan (Title V Majors and a subset of the synthetic minor (SM) universe – SM sources that emit or have the potential to emit emissions at or above 80% of the Title V major source threshold (“SM-80s”). Other facilities may also be included in a CMS plan if a state/local agency is implementing an “alternative” CMS plan). The Clean Air Act requires that delegated agencies and EPA track all federally reportable sources in the ICIS-Air database.             GHG "Direct Emitters" are facilities that combust fuels or otherwise put GHGs into the atmosphere directly from their facility. GHG "Suppliers" are those entities that supply certain fossil fuels or fluorinated gases into the economy which, when combusted, released or oxidized emit greenhouse gases into the atmosphere. Learn about the Greenhouse Gas Reporting Program (GHGRP).

CWA - Each CWA Source ID or National Pollutant Discharge Elimination System (NPDES) permit is defined by the program office as a Major or non-major discharger. This field also indicates the permit type.

RCRA - Indicates the type of hazardous waste activity at the facility, including Treatment, Storage and Disposal Facility (TSDFs), Large Quantity Generator (LQG), Small Quantity Generators (SQG), Very Small Quantity Generator (VSQG), and Transporters. Operating TSDFs are noted as such (other TSDFs are inactive but haven’t completed all regulatory requirements for closure).

SDWA - Indicates the type of owner, water source, primary service area description, and system for each unique ID for systems and facilities regulated under the Safe Drinking Water Act, which are tracked in the Safe Drinking Water Information System (SDWIS) database.

Owner 

Water system owner type (e.g., Public or Private)

Primary Water Source Type 

Primary Source Water Type categorizes the primary water source for the public water system. the source of water determines treatment requirements, or other standards. For example, the presences of any surface water sources in a public water system's inventory forces a surface water (SW) classification, even though more groundwater may be supplied than surface water. Any groundwater under the influence of surface water sources in a water system inventory necessitates a Ground Water Under the Influence of Surface Water (GUISW) classification. These higher classifications dictate higher monitoring requirements for the water system and greater public health protection.

- Surface Water - System has a surface source (e.g., river, reservoir, intake).
- Ground Water - System has a groundwater source that is not under the direct influence of surface water (e.g., protected wells) and no surface water or groundwater under the influence of surface water sources.
- Ground Water Under Direct Influence of (UDI) Surface Water - System has a source that provides water under the direct influence of surface water (e.g., unprotected well or springs) and no surface water sources.
- Purchased Surface Water - System purchases water that originates from a surface source (e.g., river, reservoir, intake.
- Purchased Groundwater - System purchases water that originates from groundwater source that is not under the direct influence of surface water (e.g., protected wells) and no surface water or groundwater under the influence of surface water sources.
- Purchased Groundwater UDI Surface Water - System purchases water that originates from a source that provides water under the direct influence of surface water(e.g., unprotected well or springs)and no surface water sources.

System Type 

The type of drinking water system.             Public water system (PWS) - A public water system is a system for the provision to the public of piped water for human consumption, which has at least 15 service connections or regularly serves an average of at least 25 individuals at least 60 days out of the year.

- Community water system (CWS) - A public water system that serves at least 15 service connections used by year-round residents or regularly serves at least 25 year-round residents (e.g., homes, apartments and condominiums that are occupied year-round as primary residences).
- Non-community water system (NCWS) - A public water system that is not a community water system.Non-transient non-community water system (NTNCWS) - A non-community water system that regularly serves at least 25 of the same nonresident persons per day for more than six months per year. A typical example is a school or an office building that has its own water source, such as a drinking water well.
- Transient non-community water system (TNCWS) - A non-community water system that does not serve 25 of the same nonresident persons per day for more than six months per year. A typical example is a campground or a highway rest stop that has its own water source, such as a drinking water well.
- Unknown - The primacy agency did not report the type of system to EPA.
- Non-Public (NP) - A drinking water system reported to the EPA by a primacy agency that does not meet the definition of Public Water System above.

Status

The status assigned to the facility by each national program database, as applicable.

CAA program status codes represent the operational condition of the facility:

- Operating
- Planned Facility
- Under Construction
- Temporarily closed
- Permanently closed
- Seasonal
- NESHAP Spraying
- NESHAP Renovation
- NESHAP Demolition
- Landfill

CERCLA indicates whether a site is on The National Priorities List (NPL). The NPL is a list of sites of national priority among the known releases or threatened releases of hazardous substances, pollutants, or contaminants throughout the United States and its territories. The NPL is intended primarily to guide the EPA in determining which sites warrant further investigation.

CWA designates a permitted facility as Active or Inactive. Under the CWA, all facilities discharging pollutants from a point source (e.g., a pipe) to surface waters must have a NPDES permit. For CWA, ICIS-NPDES designates a permit as Effective, Administratively Continued, Expired, Not Needed, Pending, Retired, or Terminated.

GHG displays whether a facility with a Greenhouse Gas Reporting Program ID number is subject to reporting its greenhouse gas emissions. Learn about the Greenhouse Gas Reporting Program (GHGRP) and verification requirements.             GHG statuses reflect the most recent reporting year. Options are:

- Verification in progress. Facility certified this report after the annual reporting deadline.
- Facility certified this report after the annual reporting deadline.
- Discontinued reporting without a valid reason.
- Discontinued reporting with a valid reason.
- Reporting and meeting Verification requirements.

RCRA facilities ("sites") are designated as Active or Inactive. Active means a site has activities occurring that are regulated under the federal Resource Conservation and Recovery Act (RCRA), Subtitle C, or an authorized state's hazardous waste management regulations/statutes; or a site which has not been determined to be inactive for such regulated activities.

Activity status definitions are intended only for the purposes of data management and providing the public with information about hazardous waste or other RCRA Subtitle C activities. Activity status is determined from the information most recently submitted by a site's representative or determined by EPA or state authority. The designation of a site as "active" or "inactive" and the subcategories below have no legal or regulatory significance.

When a site is shown as Active on the Detailed Facility Report, one to five characters in parentheses will indicate the activities that led to the Active designation. The following list provides a definition for each character that may be displayed:             H - Handler activities (activities found on the federal SI form or a state-equivalent form) (Corresponds to subcategory 1 below.)             P - Permitting activities (site has at least one unit that is "active" according to RCRAInfo Legal/Operating Status) (Corresponds to subcategory 2 below.)             A - Corrective Action activities (site is in the RCRAInfo Corrective Action Workload Universe) (Corresponds to subcategory 4 below.)             C - Converter (the site has at least one unit that is a converter according to RCRAInfo Legal/Operating Status) (Corresponds to subcategory 3 below.)             S - State-specific activities (site has state-defined activities in the RCRAInfo Permitting or Handler module which the state wants included in the activity status calculation) (Corresponds to subcategory 5 below.)

RCRA site activity status definitions and site activity status designations are described below. The overall activity status of a site is Active if the site has activities from any of the five subcategories below, otherwise the site is deemed Inactive.

| RCRA Activity (Based on Most Recent RCRAInfo data) | Description | Caveats |
|---|---|---|
| Site Identification (SI) Activities | Regulated activities reported in Section 10 on the federal RCRA Subtitle C Site Identification (SI) Form (or 8700-12) or state-equivalent form. Only current activities (as determined by the RCRAInfo universe calculations) are considered. If any of these activities are checked as present at a site, then the site is considered to have SI activities. | Excludes TSD and "Other" Universal Waste ("Other" Universal Waste is considered a State-Specific Activity |
| Treatment, Storage, Disposal (TSD) activities | Activities for which EPA may enforce federal RCRA TSDF regulations, permits, and orders or a state may enforce regulations, permits, and orders under its authorized hazardous waste management plan. A site is considered to have TSD activities if one or more of its TSD units have a current Legal/Operating status code combination indicating it is in the Regulated ("R") Universe | This definition may be revised. |
| Converters | Converters are former TSD units that "converted" to hazardous waste activities not requiring a permit, but have not been closed by the site as required by EPA or a state. A site is considered to have Converter status if one or more of its units have a current Legal/Operating status code combination indicating it is in the Converter ("V") Universe | This definition may be revised. |
| Corrective Action (CA) activities | Corrective Action activities for which a site is subject to enforceable RCRA obligations. The presence of the site in the RCRAInfo Corrective Action Workload Universe is the method by which a site is determined to be active. | This definition may be revised. |
| State-specific Activities | Activities, other than those listed under the previous four subcategories, which a state regulates and tracks in RCRAInfo and whose presence at a site the state considers sufficient reason to determine the site to be "active." These additional activities may be "same as," "more stringent than," or "broader in scope" than federal regulations. They are generally state variants of SI or TSD activities. | |

Federal regulations do not require a subsequent notification if a non-treatment, storage, or disposal facility (TSDF) changes its status (requirements vary from state to state); however, TSDFs are required to notify when owner/operator information changes. Therefore, non-TSDF data may show a site activity status that is no longer current at the site.

SDWA systems are designated as Active or Inactive. SDWA systems activity status definitions are described below.

- Active - A system is active if it produces drinking water on a regular basis. A seasonal water system may also be considered active if it is expected to resume operation within the year.
- Inactive - Not active. This includes systems that have gone out of business or been merged into other drinking water systems.

Areas

Displays Clean Air Act stationary source program code, Clean Water Act-NPDES permit component(s), applicable CAMD program areas and/or other Resource Conservation and Recovery Act designations, if any. For SDWA, displays the estimated average daily population served by a water system. For GHG, displays a list of the industries under which the facility is subject to report as part of the Greenhouse Gas Reporting Program. Review a list of covered types of industrial operations and informational resources.

Permit Expiration Date (CWA only)

Date on which a given Clean Water Act-NPDES permit is scheduled to expire. An expired date does not mean the facility is operating without a permit. In most cases, the facility has applied for a permit renewal, but the responsible authority (local, state, or federal) has not completed the re-issuance. Typically facilities operate under the conditions of the expired permit until the renewal has been processed. Some states are experiencing a backlog in issuing permit renewals, particularly under the Clean Water Act. EPA suggests contacting the relevant state agency for more information about permit renewal status. In these situations, the expired permit is normally administratively extended and kept in effect until the new permit is issued.

Indian Country

A value of "N/A" (Not Applicable) indicates this information is not maintained in the program data system. "N" indicates the facility is not in Indian Country, and a value of "Y" indicates the facility is in Indian Country according to the source database.

Latitude/Longitude

The latitude and longitude of the facility or permit holder as maintained in each data system.

#### Facility Address Table

System

The data source associated with the additional facility information.

| Acronym | Data System |
|---|---|
| ICIS-Air | ICIS-Air |
| EIS | Emissions Inventory System |
| FRS | Facility Registry Services |
| GHG | Greenhouse Gas Emissions |
| ICIS-NPDES | ICIS National Pollutant Discharge Elimination System (ICIS-NPDES) |
| RCRAInfo | Resource Conservation and Recovery Act Information System (RCRAInfo) |
| RMP | Clean Air Act Risk Management Plan Program |
| SDWIS | Safe Drinking Water Information System |
| SEMS | Superfund Enterprise Management System |
| TRI | Toxics Release Inventory |
| TSCA | Toxic Substances Control Act |

Statute

Identifies the environmental statute associated with each of the permits and identifiers linked to the facility. The first row of this table is typically FRS data, which are not associated with a particular statute.

- CAA — Clean Air Act
- CWA — Clean Water Act
- RCRA — Resource Conservation and Recovery Act
- SDWA — Safe Drinking Water Act
- EP313 — Emergency Planning and Community Right-to-Know Act, Section 313 (i.e., the Toxics Release Inventory (TRI) program)
- TSCA - Toxic Substances Control Act
- RMP - Risk Management Plan Rule
- CAMD - Clean Air Markets Division
- CERCLA - Comprehensive Environmental Response, Compensation, and Liability Act

Identifier

An alphanumeric field that displays the source database abbreviation and the unique value assigned for each record/permit/site within each data system. These identifiers are for tracking purposes in the individual data systems. The identifier used in the federal ICIS-Air database is typically different from the permit number issued to the facility.

Facility Name

Company or permit holder name, as maintained by each data system. The facility name may differ across EPA databases due to differences in reported information, change in ownership, use of parent or subsidiary name, etc.

Facility Address

Street address where the facility is located, as maintained by each data system. The street address may differ across EPA databases due to differences in reported information (e.g., use of mailing address), change in ownership, use of parent or subsidiary address, etc.

#### Facility SIC Codes Table

System

The data source associated with the additional facility information.

| Acronym | Data System |
|---|---|
| ICIS-Air | ICIS-Air |
| EIS | Emissions Inventory System |
| FRS | Facility Registry Services |
| GHG | Greenhouse Gas Emissions |
| ICIS-NPDES | ICIS National Pollutant Discharge Elimination System (ICIS-NPDES) |
| RMP | Clean Air Act Risk Management Plan Program |
| SDWIS | Safe Drinking Water Information System |
| TRI | Toxics Release Inventory |
| TSCA | Toxic Substances Control Act |

Identifier

An alphanumeric field that displays the source database abbreviation and the unique value assigned for each record/permit/site within each data system. These identifiers are for tracking purposes in the individual data systems. The identifier used in the federal ICIS-Air database is typically different from the permit number issued to the facility.

SIC Code

Standard Industrial Classification (SIC) codes, as maintained by each data system. Some SIC codes may reflect historical activities at a facility. SIC codes were established by the Census Bureau to identify processes, products and services. Each data system has different criteria for incorporating this information.

SIC Description

Description of the associated SIC Code.

#### Facility Industry Effluent Guidelines Table

This table will display only for facilities with NPDES IDs.

Identifier

An alphanumeric field that displays the unique value assigned for each record/permit/site within ICIS-NPDES. 

Effluent Guideline (40 CFR Part)

Effluent Guidelines are the national standards for industrial wastewater discharges to surface waters and publicly owned treatment works (municipal sewage treatment plants). This field specifies the part of the Code of Federal Regulations (CFR) that contains the applicable Effluent Guidelines (e.g., 40 CFR Part 436). To see a list of the applicable 40 CFRs Parts, please visit the Industrial Effluent Guidelines page.

Effluent Guideline Description

Text description of the associated Effluent Guideline. 

#### Facility NAICS Codes Table

System

The data source associated with the additional facility information.

| Acronym | Data System |
|---|---|
| ICIS-Air | ICIS-Air |
| EIS | Emissions Inventory System |
| FRS | Facility Registry Services |
| GHG | Greenhouse Gas Emissions |
| ICIS-NPDES | ICIS National Pollutant Discharge Elimination System (ICIS-NPDES) |
| RCRAInfo | Resource Conservation and Recovery Act Information System (RCRAInfo) |
| RMP | Clean Air Act Risk Management Plan Program |
| SDWIS | Safe Drinking Water Information System |
| TRI | Toxics Release Inventory |
| TSCA | Toxic Substances Control Act |

Identifier

An alphanumeric field that displays the source database abbreviation and the unique value assigned for each record/permit/site within each data system. These identifiers are for tracking purposes in the individual data systems. The identifier used in the federal ICIS-Air database is typically different from the permit number issued to the facility.

NAICS Code

All NAICS codes associated with the facility, as maintained in each data system. Some NAICS codes may reflect historical activities at a facility. The North American Industry Classification System (NAICS) has replaced the U.S. Standard Industrial Classification (SIC) system. For detailed information about NAICS and for a crosswalk between NAICS and SIC codes, please check the U.S. Census Bureau NAICS page.

NAICS Description

Description of the associated 6-digit NAICS Code

#### Facility Tribe Information Table

The Facility Tribe Information table displays the tribes or tribal territories located within 25 miles of the facility's location. EPA compares the facility location in its Facility Registry Service to the U.S. Census Bureau 2016 tribal boundary layer data for tribes in the lower 48 states and Bureau of Land Management Alaska State Office data for tribes in Alaska. The tribal boundary locations identified are suitable only for general spatial reference and do not necessarily reflect EPA's position on any Indian country locations or boundaries, or the land status of any specific location.

Data Quality Caveat: EPA makes no claims regarding the accuracy or precision of data concerning Indian country locations or tribal boundaries on the ECHO website. EPA has simply attempted to collect certain readily available information relating to Indian country locations. The associated dataset contains information on the following tribal categories: Alaska Native Villages, American Indian Reservations, American Indian Off-reservation Trust Lands, Oklahoma Tribal Statistical Areas, and Virginia Federally Recognized Tribes .Questions concerning data should be referred to the originating program or Agency which can be referenced in EPA’s Shared Enterprise Geodata Services (SEGS) metadata files located on the Guidance for Using Tribal Boundaries, Areas and Names Resources page. The Indian country and tribal boundary locations are suitable only for general spatial reference and do not necessarily reflect EPA's position on any Indian country locations or tribal boundaries or the land status of any specific location. The inclusion of Indian country information on the ECHO website does not represent any final EPA action addressing Indian country locations or boundaries. This information cannot be relied upon to create any rights, substantive or procedural, enforceable by any party in litigation with the United States or third parties. EPA reserves the right to change information on ECHO at any time without public notice.

Boundaries for both American Indian Reservations, American Indian Off-reservation Trust Lands, and Oklahoma Tribal Statistical Areas were collected from the U.S. Department of Commerce (USDOC), U.S. Bureau of the Census (Census Bureau). Originally reported by federally recognized tribal governments, these boundaries were updated by Census Bureau through the Boundary and Annexation Survey (BAS) on May 1, 2024 (American Indian Reservations) and April 15, 2024 (Alaska Native Villages, Off Reservation Trust Lands, and Oklahoma Tribal Statistical Areas) respectively. Virginia Federally Recognized Tribes contains point data for tribes geographically located in the state of Virginia, corresponding with the administrative boundaries of EPA Region 3. These tribes are federally recognized, but do not currently have land in federal status. Locations are based on mailing addresses for each tribe provided by the EPA Region 3 Tribal Program Coordinator to the US EPA Office of Mission Support on May 5, 2021 and remain current as of April 15, 2025.

Of these tribal entities, Alaska Native Villages, Alaska Native Allotments, American Indian Reservations and American Indian Off-reservation Trust Lands represent legal entities. In context, “legal entities” does not speak to the legal status of feature class boundaries associated with these data. They do not constitute a determination of jurisdictional authority or rights of ownership or entitlement and are not legal land descriptions. These data may only be used for statistical collection and tabulation purposes. Oklahoma Tribal Statistical Areas are considered statistical entities, meaning that they are collected for statistical or tabulation purposes. Note that due to a recent Supreme Court decision, Oklahoma Indian country boundaries are in a state of flux. Changes will be incorporated in future dataset iterations.

Reservation Name

Name of the Indian country reservation that the facility is located on or near.

Tribal Name

Name of the tribe located within the boundary locations that the facility is located on or near.

EPA Tribal ID

ID given by EPA to identify the tribe.

Distance to Tribe (miles)

The facility's distance in miles to the tribe or tribal territory.

#### Top of Page Enforcement and Compliance This section summarizes the history of enforcement and compliance activities. Filter Enforcement and Compliance Information

Radio buttons allow you to restrict the data displayed in each of the Enforcement and Compliance tables to a particular statute (CAA, CWA, RCRA, or SDWA). The number in parentheses after each statute indicates the number of compliance monitoring activities listed in the Compliance Monitoring History table for that statute.

The table below indicates the availability of enforcement and compliance data for the Clean Air Act, Clean Water Act, Resource Conservation and Recovery Act, and Safe Drinking Water Act. Select an "X" to jump to the statute-specific help documentation for each table in this section of the DFR.

| Statute | Compliance Pipeline | Compliance Monitoring History | SDWA Sanitary Survey Results (5 Years) | Compliance Summary Data | Three-Year Compliance History by Month/Quarter | Informal Enforcement Actions | Formal Enforcement Actions | SDWA Violations and Enforcement Actions (5 Years) |
|---|---|---|---|---|---|---|---|---|
| CAA | X | X | | X | X | X | X | |
| CWA | | X | | X | X | X | X | |
| RCRA | X | X | | X | X | X | X | |
| SDWA | | X | X | X | X | X | X | X |

#### Compliance Pipeline

The pipeline view on DFR provides a link between inspections, violations, and enforcement actions in a consolidated table, so it is easier to see how the compliance and enforcement data are related. Note that linkages depend on the extent of data entered into EPA’s source systems, ICIS, RCRAInfo, and SDWIS.

Additional information related to compliance monitoring, violations, and actions are included in the "classic" table views below the pipeline. If there are no linkages between these activities at the facility, the pipeline view is not displayed. 

#### Key Terms

Violation identified, noncompliance, significant noncompliance, significant noncomplier, enforcement priority, and high priority violation are all terms used by the ECHO website to describe the facility's status in regard to compliance with the law. In many cases, these terms reflect determinations made by EPA or states when conducting inspections or reviewing facility self-reports. These determinations assist the government in tracking resolution of violations through the enforcement process and do not necessarily represent a final adjudication by a judicial or administrative body. In such cases, these characterizations should be considered alleged violations. Additional information on how to interpret a facility's compliance status is available on ECHO's Frequently Asked Questions page.

##### Compliance Monitoring

Compliance monitoring activities entered in RCRAInfo or ICIS-Air from the past ten years are displayed in this table. CAA compliance monitoring activities not linked to any violation or enforcement are excluded from this table, but can be viewed in the Compliance Monitoring History table below. 

For CAA violations not discovered through a linked compliance monitoring activity, the violation's reported discovery action (if any) are displayed as the compliance monitoring activity alongside the violation. 

Source ID

An alphanumeric field which is a unique value for each record/permit/site within each data system. These identifiers are for tracking purposes in the individual data systems. For records from ICIS, this is the programmatic ID. For CAA, the Source ID appears above the pipeline table rather than in a separate column. 

Compliance Monitoring Type 

A description of the type of compliance monitoring activity undertaken, or of the reported discovery action. "Date Out of Range" appears here if a violation was discovered by an activity that occurred previous to the past 10 years. 

Compliance Monitoring Agency

Identifies the lead agency (e.g., EPA, State) conducting the compliance monitoring activity or reported discovery action. 

Compliance Monitoring Date

The calendar date of the compliance monitoring activity or reported discovery action. 

##### Violations

All violations linked in RCRAInfo or ICIS-Air to a compliance monitoring activity are listed in the same row as that activity. A violation linked to multiple compliance monitoring activities appears next to the earliest linked activity in this table.

For CAA violations not discovered through a linked compliance monitoring activity, the violation is displayed in the same row as the reported discovery action (if any). If the violation has no reported discovery action or linked compliance monitoring activity, the compliance monitoring columns next to the violation are left blank. 

Violation Type

A value of “No Violation Identified” in this column indicates that no violations were identified in connection with the listed compliance monitoring activity, and “Undetermined” indicates that the Agency has not yet made a violation determination. “No New Violations Reported” (for RCRA) or "Linked to Viol. Below" (for CAA) indicates that previously reported violations were linked to the listed compliance monitoring activity but no new violations were reported. Each violation in the Compliance Pipeline table is hyperlinked to it's corresponding Violation Report. 

Violation Agency

The environmental agency addressing the violation. For a list of state environmental agency websites, see Access State Websites. 

Violation Programs (CAA Only)

The CAA program with which the violation is associated. A list of CAA programs can be found under Three- Year Compliance History by Month/Quarter. 

Violation Determined Date

The date on which the violation was determined.

Return to Compliance Date (RCRA Only)

The date on which compliance was again attained, or "Open" if no such date has been entered. 

Violation End Date (CAA Only) 

The date on which the violation was resolved. For FRVs, most agencies do not report an end date, in which case this column is populated with “N/A.” For HPVs and for agencies that choose to display an FRV date range in ECHO, this column displays the Resolved Date entered by the agency or “Unresolved” if no such date has been entered.

##### Enforcement Actions

All enforcement actions linked in RCRAInfo or ICIS-Air to a violation associated with a compliance monitoring activity are listed in the same row as that activity. Enforcement actions linked in ICIS-Air to a compliance monitoring activity but no violation, or only to a violation with no associated compliance monitoring activity, are listed in the same row as the compliance monitoring activity or violation to which they are so linked.

Enforcement Type

The type of informal or formal enforcement action linked to one or more activities in the row. For formal enforcement actions entered in ICIS (including ICIS-Air), this value is hyperlinked to the action’s Civil Enforcement Case Report. “Date Out of Range” appears here if a violation in this table is linked to an action that occurred outside the past 10 years.

For more information on what constitutes informal and formal enforcement actions, please see the Informal and Formal Actions Summary of Guidance and Portrayal on EPA Websites.

Enforcement Action Date

The calendar date (MM/DD/YYYY) the enforcement action was taken. For CAA formal enforcement actions, the "Settlement/Action Date" is displayed here if available. Otherwise, the "Issued/Filed Date" is displayed, alongside an asterisk indicating that no final order has been reported. See Formal Enforcement Actions below for more details. 

Penalty Assessed

The federal or state/local penalty assessed. For a federal enforcement action entered in ICIS as well as RCRAInfo, the penalty amount entered in ICIS is provided here.

Comp Action Cost

The whole dollar amount of the estimated or actual value of the complying action activities entered in ICIS (including ICIS-Air).

#### Compliance Monitoring History

The Compliance Monitoring History table lists all compliance monitoring activities that have occurred under the following environmental statutes. Users can choose to view the activity over the past five or ten years, with five as the default.

The table lists all federal and state activities reported into federal data systems using federally-designed codes. Unofficial activities include various compliance monitoring activities not included in EPA's compliance monitoring strategies or Annual Results.

Statute

Identifies the environmental statute associated with each of the permits and identifiers linked to the facility:

- AIM - American Innovation and Manufacturing Act
- CAA — Clean Air Act
- CWA — Clean Water Act
- EP313 — Emergency Planning and Community Right-to-Know Act, Section 313 (i.e., the Toxics Release Inventory (TRI) program)
- FIFRA — Federal Insecticide, Fungicide, and Rodenticide Act
- RCRA — Resource Conservation and Recovery Act
- SDWA — Safe Drinking Water Act
- TSCA — Toxic Substances Control Act

Source ID

An alphanumeric field which is a unique value for each record/permit/site within each data system. These identifiers are for tracking purposes in the individual data systems. For records from ICIS, this is the programmatic ID.

System

The data source associated with the additional facility information.

| Acronym | Data System |
|---|---|
| ICIS-Air | ICIS-Air |
| EIS | Emissions Inventory System |
| FRS | Facility Registry Services |
| GHG | Greenhouse Gas Emissions |
| ICIS-NPDES | ICIS National Pollutant Discharge Elimination System (ICIS-NPDES) |
| RCRAInfo | Resource Conservation and Recovery Act Information System (RCRAInfo) |
| SDWIS | Safe Drinking Water Information System |
| TRI | Toxics Release Inventory |

Activity Type

Identifies the type of activity from ICIS. Possible values include: Compliance Investigation, Information Request, Inspection/Evaluation, and Offsite Record Review. Note that Activity Type is not applicable to the RCRAInfo or SDWIS reporting systems. 

Compliance Monitoring Type

A description of the type of compliance monitoring activity undertaken. For CWA, this field also lists the NPDES program applicable to the compliance monitoring activity type. The Detailed Facility Report includes official and unofficial compliance monitoring activities conducted within the last five or ten years. The last five years is the default display and includes data from the twenty most recently completed quarters, plus data from the current quarter up until the refresh date.

Entries in italics are not included in ECHO's Compliance Monitoring Activity counts because they are not compliance monitoring strategy activities or because the are not counted as inspections within EPA's annual results.

Clean Air Act (CAA) Stationary Source Program (ICIS-Air) 

Official activities included are those counted under the CAA stationary source program or included as on-site non-stationary source compliance monitoring activities in EPA's Annual Results. The checked inspection types below indicate inspections that are included in official counts under the CAA stationary source program. A Full Compliance Evaluation (FCE) includes comprehensive paperwork review and often, but not necessarily, an on-site inspection. Compliance evaluations that do not qualify as FCEs are characterized as "partial." Partial means that some compliance monitoring was done, but all requirements were not met to receive credit for a Full Compliance Evaluation. 

Information on additional CAA inspections: In addition to the compliance evaluations from ICIS-Air, the national database for the stationary source program, EPA inspections under the following CAA sections are displayed when recorded in the Integrated Compliance Information System (ICIS): 112(r), 118(d), 202, 203, 207, 208, 211, 213, and 219.

| Compliance Monitoring Type | CAA Official Evaluations |
|---|---|
| CST - Stack Test | |
| INV - Investigations | |
| FOO - FCE On-Site (EPA or State conducted) | ✓ |
| FFO - FCE Off-Site (EPA or State conducted) | ✓ |
| PFF - PCE Off-Site | |
| PCE - PCE On-Site | |
| POC - PCE Off-Site CEMS/CMS Audit | |
| POF - PCE On-Site Fenceline/Ambient Monitoring | |
| POI - PCE On-Site Interview | |
| POM - PCE On-Site Monitoring/Sampling | |
| POR - PCE On-Site Record/Report Review | |
| POV - PCE On-Site Visible Emission Observation | |
| TVA - Title V Annual Compliance Certification (TV ACC) Receipt/Review | |

Stack Tests: Following a Clean Air Act source or performance stack test listed in the Compliance Monitoring History table, the "Finding" column includes the result of the stack test (Pass, Fail, Pending, or Blank) along with the pollutant tested, if it is reported. Please note that the pollutant tested is not required to be reported, although it is recommended.

A stack test, also referred to in EPA regulations as a performance or source test, measures the amount of specific regulated pollutant(s) or surrogates being emitted; demonstrates the capture efficiency of a capture system; or determines the destruction or removal efficiency of a control device used to reduce emissions at facilities subject to the requirements of the Clean Air Act. Stack tests are discussed in the Clean Air Act Stationary Source Compliance Monitoring Strategy (CMS), which provides recommendations to state and local environmental agencies to encourage national consistency in developing stationary source air compliance monitoring programs.

Title V Annual Compliance Certification (TV ACC Receipt/Review): Following a Title V Annual Compliance Certification Review or Title V Annual Compliance Certification Due/Received action, the Finding column includes the result of the review (In Compliance, In Violation, or Unknown), as well as whether any deviations were reported (Yes or No). Note: These actions may be performed and reported by a state permit authority or an EPA regional office, which also receives these documents from the permitted facilities as required in the permit and EPA Title V regulations. The CAA Stationary Source CMS provides details.

The results of performance stack tests conducted and of Title V Certification Reviews are required to be reported to the national program database, ICIS-Air (AIR), based on the Information Collection Request. Regarding stack test results, as noted above, EPA does not require that the pollutant tested be reported. However, a violation of a major facility's allowable emission limit detected during a stack test may trigger a high priority violation status, according to the policy on the Timely and Appropriate Enforcement Response to High Priority Violations (HPV Policy).

Detailed information is available from the following links/documents:

- EPA Air Enforcement Policy, Guidance, and Publications
- CAA Stationary Source Compliance Monitoring Strategy
- HPV Policy
- Federally-Reportable Violations Guidance
- CAA National Stack Testing Guidance

Clean Water Act (CWA) National Pollutant Discharge Elimination System Program (NPDES) (ICIS-NPDES) 

Official activities included are those counted under the CWA National Pollutant Discharge Elimination System Compliance Monitoring Strategy or included as on-site CWA non-NPDES compliance monitoring activities in EPA's Annual Results. 

Information on additional CWA inspections: In addition to the NPDES compliance monitoring activities from ICIS-NPDES, the national database for the CWA pollutant discharge program, EPA inspections under the following CWA sections are displayed when recorded in the Integrated Compliance Information System (ICIS): 311 and 404.

| Compliance Monitoring Type |
|---|
| AFD - AFO Defined |
| AER - Aerial Photography |
| AU1 - Audit |
| AU2 - Audit |
| CBI - Biomonitoring |
| CDI - Case Development |
| CDF - Case Development - Off-Site |
| CDO - Case Development - On-Site |
| DSA - Desk Audit |
| DIA - Diagnostic |
| CEI - Evaluation |
| CE2 - Evaluation (IU) |
| FOC - Focused |
| FLP - Follow-Up |
| OSV - On Site Visit |
| OVS - Oversight |
| PRV - Plan Review |
| RWS - Reconnaissance with Sampling |
| ROS - Reconnaissance without Sampling |
| RMT - Remote Sensing |
| SA1 - Sampling |
| PSI - Sampling (IU) |
| SCE - Schedule Evaluation |
| SCV - Self-Certification Verification |
| TX1 - Toxics |

| Code | Description |
|---|---|
| CWAPEST | Pesticide Application |
| CWASTMC | Construction Stormwater |
| CWAFRP | FRP (Facility Response Plan) |
| CWASTMM | Urban Stormwater (MS4) |
| CWASTMN | Industrial Stormwater |
| CWAOPA | OPA (Oil Pollution Act) |
| CWAPRTRT | Pretreatment |
| CWASSO | SSO (Sanitary Sewer Overflows) |
| CWACSO | CSO (Combined Sewer Overflows) |
| CWAIR | 308 Information Request |
| CWAS | Biosolids |
| CWACAFO | CAFO (Concentrated Animal Feeding Operation) |
| CWAOTHR | Base Program |
| EMRGNCYA | Emergency Actions |
| CWASPILL | Spills |
| CWAOUPD | Other Unpermitted Discharges |
| CWAWTL | Wetlands |
| CWAVOACO | Administrative Compliance Order |
| CWAPAPC | Post Administrative Penalty Case |
| CWASPCC | Spill Prevention, Control, and Countermeasure (SPCC) |

Resource Conservation and Recovery Act (RCRA) Hazardous Waste Program (RCRAInfo) 

Official activities included are those included in official counts under the RCRA hazardous waste program or included as on-site RCRA non-hazardous waste compliance monitoring activities in EPA's Annual Results. RCRA inspection types are further described in the Nationally Defined Values for Evaluation Type file (3 pp, 12 K, About PDF) from the source data system, RCRAInfo. RCRA "official" inspections are those that tend to take place on-site. Financial Record Reviews and Non-Financial Record Reviews are evaluations of compliance, but they typically take place in the regulatory agency office. The Compliance Monitoring Strategy for the Resource Conservation and Recovery Act provides more detail on each of the compliance monitoring types.

Information on additional RCRA inspections: In addition to the RCRA hazardous waste (Subtitle C) inspections from RCRAInfo, the national database for hazardous waste data, EPA inspections under the following RCRA sections are displayed when recorded in the Integrated Compliance Information System (ICIS): 9002, 9003, 9005, and 9006.

| Compliance Monitoring Type | RCRA Official Inspections |
|---|---|
| CAC - Corrective Action Compliance Evaluation | |
| CAV - Compliance Assistance Visit | |
| CDI - Case Development Inspection | |
| CEI - Compliance Evaluation Inspection | ✓ |
| CSE - Compliance Schedule Evaluation | |
| FCI - Focused Compliance | |
| FRR - Financial Record Review | |
| FSD - Facility Self Disclosure | |
| FUI - Follow-Up Inspection | |
| GME - Groundwater Monitoring Evaluation | ✓ |
| LBN - Land Ban Restrictions Inspection | |
| NIR - No 3007 Information Request Received | |
| NRR - Non-Financial Record Review | |
| OAM - Operation and Maintenance Inspection | ✓ |

Safe Drinking Water Act (SDWA) Program (SDWIS) 

Official activities included are those included in the inspection counts under the SDWA public water systems program. Inspections are either site visits with a visit reason of "investigation" or "site inspection" in SDWIS, EPA SDWA Inspection/Evaluation in ICIS, or on-site SDWA compliance monitoring activities in EPA's Annual Results.

| Site Visit Type | SDWA Official Inspections |
|---|---|
| Investigation (Complaint/Violation/etc.) | ✓ |
| Site Inspection | ✓ |
| Capacity Development Assessment | |
| Compliance Assistance | |
| Construction Inspection | |
| Comprehensive Performance Evaluation (CPE) | |
| Emergency Assistance | |
| Engineering Determination/Advice/Plan Review | |
| Formal Enforcement | |
| Follow-up to Formal Enforcement | |
| Informal Enforcement | |
| Informal System Inspection | |
| Laboratory Certification | |
| Laboratory Inspection | |
| Locational Data Collection | |
| Needs Survey | |
| Operation and Maintenance | |
| Other | |
| Permit (Qualification/Review/Compliance) | |
| Public Hearing | |
| Record Review | |
| Regularly Scheduled | |
| Sanitary Hazards Investigation | |
| Sample Collection | |
| Sanitary Survey, Partial | |
| Sanitary Survey, Complete | |
| Source Water Inspection | |
| State Revolving Fund | |
| Sanitary Survey Follow-up | |
| Technical Assistance (Non-specific) | |
| Training | |
| Water Treatment Plant Site Visit | |
| Variance/Exemption related | |
| Wellhead Protection Program | |
| Watershed Evaluation | |
| Cross Connection Inspection/Investigation | |

Integrated Compliance Information System (ICIS) Federal Enforcement and Compliance (FE&C)

For a complete list of inspection types in ICIS FE&C for several environmental statutes, see the ICIS FE&C Inspection Types page. 

Lead Agency

Identifies the lead agency (e.g., EPA, State) conducting the compliance monitoring activity. For some air and NPDES compliance monitoring activities, the lead agency could be incorrectly designated as EPA if EPA reported the activity to the data system on behalf of the state.  

Date

The calendar date of the listed activity.

Finding

CAA: includes results of source or performance stack tests or Title V certification review results, when applicable.             CWA: not applicable.             RCRA: includes whether violations or compliance issues were found during an inspection, if entered into an EPA system.SDWA: not applicable.Note that due to differences in program reporting systems, the Finding column is not applicable to all media compliance monitoring activities. Cells that correspond to non-applicable reporting systems  (ICIS-NPDES, ICIS, and SDWIS) are darkened gray. Entries in italics are not considered inspections in official counts.

Top of Page

#### SDWA Sanitary Survey Results (5 years)

Includes occurrences of sanitary surveys and other kinds of site visits, including technical assistance, sample collections, and site inspections.

Date

The calendar date (MM/DD/YYYY) of the listed site visit.

Type

A description of the type of site visit conducted.

Agency

The lead agency that conducted the site visit.

Sanitary Survey Results

Every public water system is required to be evaluated by a sanitary survey every three to five years. A sanitary survey is an on-site review of a system's water source, facilities, equipment, operation, and maintenance, intended to point out sanitary deficiencies and assess the system's capability to supply safe drinking water. Systems are evaluated on 11 different aspects of public water system (PWS) operation, and the results are recorded using the following codes:

| Code | Result Description |
|---|---|
| M | Minor Deficiencies |
| N | No Deficiencies or Recommendations |
| R | Recommendations Made |
| S | Significant Deficiencies |
| X | Not Evaluated |
| Z | Not Applicable |
| -- | Not Reported to EPA |

Top of Page

#### Compliance Summary Data

Provides a high-level summary of compliance for each source ID (e.g., permit or program ID), including how recent the data are.

Statute

Identifies the environmental statute associated with each of the permits and identifiers linked to the facility:

- CAA — Clean Air Act
- CWA — Clean Water Act
- RCRA — Resource Conservation and Recovery Act
- TSCA — Toxic Substances Control Act
- EP313 — Emergency Planning and Community Right-to-Know Act, Section 313 (i.e., the Toxics Release Inventory (TRI) program)
- SDWA — Safe Drinking Water Act

Source ID

An alphanumeric field, which is a unique value for each record/permit/site within each data system. These identifiers are for tracking purposes in the individual data systems.

Current SNC/HPV 

The current Significant Noncompliance (SNC) or High Priority Violator (HPV) status for the facility during the most recent quarter reflects the time the records were extracted from the program data systems. SNC is used for RCRA and CWA, and HPV is used for CAA. Each program has its own specific criteria for making this determination. The value of "Yes" indicates the facility is in SNC or HPV for the permit or site in question and may pose a more severe level of environmental threat. The value of "No" indicates the permit or site is not considered in SNC or HPV.

If the facility is Non-Federally Reportable within ICIS-Air, the field reads "N/A". The value of N/A in this field indicates Not Applicable because compliance data for these facilities are not required to be reported to the national program database. When data are available, this field will indicate the compliance status for some non-major facilities in ICIS-NPDES. For non-major facilities in ICIS-NPDES, N/A indicates that EPA's data system is not able to determine the facility-level compliance status based upon the information available. For the RCRA program, some hazardous waste facilities have activities in multiple states. When the SNC activity location is not the same as the state where the facility is located, the state of the SNC activity location is displayed in parentheses. A "Yes" by itself indicates that the facility has a SNC activity location in the state where the facility is located. A brief summary of each program's definition is shown below. However, these summaries are not meant to substitute for the complete definition, which can be found in the relevant guidance documents for a given program.

Significant Noncompliance Definitions by Statute

- Clean Air Act
- Clean Water Act
- Resource Conservation and Recovery Act
- Safe Drinking Water Act

Air High Priority Violation (HPV) Definition              The Air program uses the term HPV. HPV designations are made according to the Issuance of Policy on Timely and Appropriate Enforcement Response to High Priority Violations.

The following criteria can trigger HPV status for a violation that occurs at a Title-V major source or a non-Title-V major source subject to a Compliance Monitoring Strategy (CMS) plan:

- Failure to obtain a New Source Review (NSR) permit and/or install Best Available Control Technology or Lowest Available Emission Reductions for any new major stationary source or major modifications at a major stationary source.
- Exceedance of a major stationary source annual emission threshold, as defined in the NSR regulations, by a synthetic minor stationary source.
- Violation of the any emission limitation, emission standard, or operating parameter that has continued for at least seven days, but not necessarily continuous, according to:Title I, Part C or D, of the Clean Air Act and implementing regulations,
- Standards of Performance for New Sources (NSPS) Part 60, or
- National Emission Standards for Hazardous Air Pollutants (NESHAP) Parts 61 and 63.
- Violations of federally enforceable work practices, testing requirements, monitoring requirements, recordkeeping or reporting that substantially interferes with enforcement or determination of a facility’s compliance requirements.
- Violations specifically identified and communicated to enforcement agencies by the U.S. EPA Air Enforcement Division Director, or as mutually agreed upon between the enforcement agency and corresponding EPA Region.

The HPV designation is removed for a given source when all federal and state administrative and judicial action against the source is complete, the source has completed all requirements under the consent decree or final order including payment of all penalties and completion of supplemental environmental projects, and the source has been confirmed to be complying with the CAA.

The High Priority Violation (HPV) flag is reported in ICIS-Air, as of the last update. A 'Yes' appears in the column to indicate that the facility has HPV status. Below is a list of violation codes within ICIS-Air that translate to HPV status.

- Addressed-EPA - Addressed, EPA Lead
- Addressed-State - Addressed, State Lead
- Addressed-Local - Addressed, Local Lead
- Unaddressed-EPA - Unaddressed, EPA Lead
- Unaddressed-State - Unaddressed, State Lead
- Unaddressed-Local - Unaddressed, Local Lead

The status of "Addressed" indicates that a formal enforcement action has been taken against the facility but its violations have not yet been resolved, or that a decision not to take a formal action has been made. For the CAA, violations are not considered resolved until the source is in full physical compliance and all penalties are paid. "Unaddressed" indicates that the facility's violations have not yet been addressed with a formal enforcement action or the decision to do so has not yet been made.

CWA Significant/Category I Noncompliance (SNC) Definition              The National Pollutant Discharge Elimination System (NPDES) program uses the term SNC. SNC designations are made in accordance with the December 12, 1996 guidance document General Design for SNC Redefinition Enhancement in PCS (PDF) (27 pp, 2.8 MB, About PDF ). Most SNC designations are based on an automated analysis of Discharge Monitoring Reports (DMRs) that facilities with NPDES permits are required to submit on a monthly basis. The compliance designation of a facility in the ICIS-NPDES database is done using a mathematical formula that takes into account the amount, duration, and frequency of discharges in comparison with permit levels. In some instances facilities may be manually designated as SNC, even if the ICIS-NPDES data system does not automatically designate them as such. Examples of events that could result in the manual generation of a SNC code for a facility include: unauthorized discharges; failure of a Publicly Owned Treatment Works (POTW) to enforce its approved pretreatment program; failure to meet a construction deadline; failure to file a DMR; filing a DMR more than 30 days late; or violating any judicial or administrative order. Manually entered compliance data, if present, override machine-generated compliance data.

A facility may have multiple discharge points and different designations for each point. If any of these points show a SNC type code, then the overall facility status is listed as SNC, even if other discharge points are in compliance.

Removal of the SNC designation occurs once the facility's DMR reports show a consistent pattern of compliance with permit limits, or if EPA or a state agency issues a formal enforcement order to address the violations that resulted in the SNC designation and the facility has returned to compliance.

The most recent quarter for ICIS-NPDES is the most recent official quarter for which the quarterly status is available. This is usually 2 1/2 months after the quarter has ended. Thus, the most recent quarter in ICIS-NPDES is often not the same quarter as that for ICIS-Air and RCRAInfo.

The following are NPDES Quarterly Noncompliance Report (QNCR) status codes that translate to SNC status (from most to least important):

| QNCR Code | SNC Status Description |
|---|---|
| S | Enforcement action or permit compliance schedule event violation - more than 90 days late. |
| E | Effluent violations of monthly average limits (Technical Review Criteria and chronic) or SNC-level single event violation. |
| X | Effluent violations of non-monthly average limits (Technical Review Criteria and chronic). |
| T | Enforcement action or permit compliance schedule reporting violation - more than 30 days late. |
| D | Reporting violation - non-receipt of DMR. |

RCRA Significant Noncomplier (SNC) Definition              The RCRA program uses the term SNC. Any determination to classify a site as a SNC is made using the guidelines set forth in the December 2003 Hazardous Waste Civil Enforcement Response Policy (PDF) (14 pp, 145 K, About PDF ). A site can be designated as a SNC if any of the following are found to exist: the site has been determined to cause actual exposure or has a substantial likelihood of causing exposure to a hazardous waste or constituent; is a chronic or recalcitrant violator; or deviates substantially from the terms of a permit, order or agreement, or from RCRA statutory or regulatory requirements. Under the RCRA program, the SNC designation is removed for a given site when the site is in full physical compliance with statutory and/or regulatory requirements.

SDWA Enforcement Priority Definition              In the Safe Drinking Water program, an Enforcement Priority Violator is a public water system with unresolved serious, multiple, and/or continuing violations, as identified by the quarterly application of EPA's Drinking Water Enforcement Response Policy (PDF) (16 pp, 952K, About PDF ), that must either return to compliance or be addressed by a formal enforcement action within six months.

EPA designates enforcement priority violators so that the drinking water system and the primacy agency will act quickly to resolve the most significant drinking water violations. Many public water systems with violations, however, are not designated as enforcement priority systems. Operators and the primacy agencies are expected to correct the violations at non-enforcement priority violators as well, but without the more strict requirements and deadlines applicable to enforcement priority violators. If the violations at a non-enforcement priority violator are left uncorrected, that system may become an enforcement priority violator. When an enforcement priority violator has returned to compliance, it is no longer designated an enforcement priority violator. EPA updates its enforcement priority violator list on a quarterly basis.

Current As Of

The most recent date or official calendar year quarter of record maintained in the data system for which the Current SNC/HPV status applies. For CAA and RCRA, the current as of date reflects the most recent data refresh. 

Qtrs with NC (of 12)

Count of the number of quarters, out of the last twelve quarters, in which the permit or site is considered either with violations identified, in noncompliance (NC) status, or in Significant Noncompliance (SNC) or High Priority Violation (HPV) status, as shown in the following section. Further violation and detailed compliance information can be found on ECHO's Frequently Asked Question page.

Data Last Refreshed

This date reflects the most recent data refresh. The complete list of data sources and dates of last updates made in ECHO are shown in About the Data. 

Top of Page

#### Three-Year Compliance History by Month/Quarter

#### Key Terms

Violation identified, noncompliance, significant noncompliance, significant noncomplier, enforcement priority, and high priority violation are all terms used by the ECHO website to describe the facility's status in regard to compliance with the law. In many cases, these terms reflect determinations made by EPA or states when conducting inspections or reviewing facility self-reports. These determinations assist the government in tracking resolution of violations through the enforcement process and do not necessarily represent a final adjudication by a judicial or administrative body. In such cases, these characterizations should be considered alleged violations. Additional information on how to interpret a facility's compliance status is available on ECHO's Frequently Asked Questions page.

The Three-Year Compliance History displays compliance status data over the last three years of available data in separate tables for each program/source ID. Information is broken down into quarterly periods listed as QTR1 through QTR12 (most recent). The quarter is used as the default measurement period because it is the shortest measurement period across all three statutes for which EPA receives noncompliance data from states. 

Violation information is displayed in a different manner for each statute. This is due to differences in how violations are tracked within each data system.

Violation: Defined as noncompliance with one or more legally enforceable obligations by a regulated entity, as determined by a responsible authority. Included in this category are violations of legally enforceable obligations under pre-existing Final Orders (e.g., violations of compliance schedules included in enforcement orders). What does it mean if a facility is in violation?

The compliance history may not reflect all actual noncompliance events in some cases. For example, EPA does not require national reporting for facilities with "minor" permits; thus, noncompliance at these facilities may not be completely shown in ECHO. For minor facilities, the authorized state may have information on violations not found in ECHO. Also, delays sometimes occur in entering noncompliance determinations into the database. Alternatively, in some cases, a facility may be shown to be in noncompliance while the facility has already remedied the underlying violation; this may occur because EPA or the state has not yet verified this. In other cases, the state or EPA may change its initial determination of noncompliance based on additional facts or discussions with the facility. Site users may report possible errors concerning noncompliance status from the facility report screen.

Notice About Duration of Violations: The duration of violations shown on this report is an estimate of the actual duration of the violations that might be alleged or later determined in a legal proceeding. For example, the start date of the violation as shown in the ECHO database is normally when the government first became aware of the violation, not the first date that the violation occurred, and the facility may have corrected the violation before the end date shown. In some situations, violations may have been corrected by the facility, but EPA or the State has not verified the correction of these violations. In other situations, EPA does not remove the violation flag until an enforcement action has been resolved.

Statute

Identifies the environmental statute associated with each of the permits and identifiers linked to the facility. Select a statute below to read about the detailed information on program, pollutant, violation type and compliance status designations:

- CAA — Clean Air Act
- CWA — Clean Water Act
- RCRA — Resource Conservation and Recovery Act
- SDWA — Safe Drinking Water Act

Quarters (QTR) 

A quarter is any of the following 3-month calendar periods: January-March, April-June, July-September, or October-December. Because quality assurance protocols differ among the data systems, the dates of the last twelve complete quarters of record may differ across EPA data systems.

Facility-Level Compliance Status 

Displays an indication of the compliance status for each statute under which the facility is regulated. Status codes include:

- No Violation Identified – Blue
- Noncompliance, Violation Identified, or Violation Unresolved - Yellow-orange
- Significant/Category I Noncompliance (CWA), Significant Noncomplier (RCRA), High Priority Violation (HPV) (CAA), or Enforcement Priority (SDWA) – Red
- Undetermined/In Progress/No Information/Not Available - Gray
- Inactive (SDWA)/Not Applicable (CWA)/Terminated Permit (CWA) - no cell shading

Air Compliance Status (CAA) 

HPV History - The High Priority Violation (HPV) flag as reported in ICIS-Air. A blank in this column means that the facility's most recent status is not High Priority Violator (HPV). If a facility is a HPV, the Facility-Level Status will display "Violation Identified" and the available details of the violation will be displayed in the HPV History table. 

"Addressed" indicates that a formal action has been taken against the facility but its violations have not yet been resolved, or that a decision not to take a formal action has been made. For the CAA, violations are not considered resolved until the source is in full physical compliance and all penalties are paid. "Unaddressed" indicates that the facility's violations have not yet been addressed with a formal enforcement action or the decision to do so has not yet been made.

Violation Type - Indicates whether a violation is a High Priority Violation (HPV) or a Federally Reportable Violation (FRV). HPVs are violations of the CAA that meet the criteria in EPA's Enforcement Response to High Priority Violations Policy. The Guidance on Federally-Reportable Violations for Stationary Air Sources outlines the types of violations that state, local, and tribal agencies are to report to EPA.

Programs/Agency/Pollutants - For Clean Air Act (CAA) permits, the table provides status information for each air permit, and within each permit, the programs to which the facility or operation is subject. Within each CAA program, individual pollutants for which the facility has a recent violation are listed on a separate line. The table also identifies the environmental agency addressing the violation. For a list of state environmental agency websites, see Access State Websites. In general, data relating to federally-reportable facilities is considered more complete.

CAA programs include:

- CAAAR - Acid Rain Deposition Control (CAA Title IV)
- CAABAC - Best Available Controls
- CAACCP - Consumer or Commercial Products
- CAACFC - CFC Tracking (CAA Title VI)
- CAAEP - Emergency Powers
- CAAFENF - Federally-Enforceable Requirement, Non Specified
- CAAFESOP -Federally-Enforceable State Operating Permit - Non Title V
- CAAFF - Federal Facilities
- CAAFIP - Federal Implementation Plan for National Primary and Secondary Ambient Air Quality Standards
- CAAGACTM - 40 CFR Part 63 Area Sources
- CAAGHG -The Mandatory Greenhouse Gas Reporting Rule
- CAAHAPS - Hazardous Air Pollutants
- CAAIRM - Information Requests, Monitoring, & Recordkeeping
- CAAL - Labeling
- CAAMACT - MACT Standards (40 CFR Part 63)
- CAAMRR - Monitoring, Reporting
- CAAMS -Mobile Sources
- CAANAAQS - National Ambient Air Quality Standards (NAAQS)
- CAANAM - Tribal Rule Not Otherwise Covered
- CAANEP - Non Essential Products
- CAANEPA - National Environmental Policy Act (NEPA)
- CAANESH - National Emission Standards for Hazardous Air Pollutants (40 CFR Part 61)
- CAANFRP - Not defined as federally-reportable
- CAANSP - Nonattainment/SIP Provisions
- CAANSPS - New Source Performance Standards
- CAANSPSM - New Source Performance Standards (Non-Major)
- CAANSR - New Source Review Permit Requirements
- CAANVCO - Notices of Violations & Compliance Orders
- CAAOP - Operating Permits
- CAAOTH - State or Local rule or regulation that is not federally-enforceable
- CAAPARGDC - Prevention of Accidental Release/General Duty Clause
- CAAPR - Permit Requirements
- CAAPSD - Prevention of Significant Deterioration of Air Quality
- CAAPSDPR - PSD Preconstruction Requirements
- CAARERP - Recycling & Emission Reduction Programs
- CAARMP - Risk Management Program
- CAASIP - State Implementation Plan for National Primary and Secondary Ambient Air Quality Standards
- CAASMVA - Servicing Motor Vehicle ACs
- CAASO - Stratospheric Ozone Protection
- CAASPP - State Permit Programs
- CAASWFC - Solid Waste Fuel Combustion
- CAATIP - Tribal Implementation Plan for National Primary and Secondary Ambient Air Quality Standards
- CAATVP - Title V Permits
- CAATVS - Tank Vessel Standards

Quarterly Status (CAA)

Dates - High Priority Violations (HPV) are listed with the beginning and return-to-compliance dates. A report showing a right arrow with no closing date (e.g., →) means that the violation has not been resolved and continues to be active in the data system. If the violation started before the last three years of data and continues into the last three years, the beginning date is listed in QTR1/Month 1. Federally Reportable Violations (FRV) are listed with the determination date or date reported in the appropriate quarter/month.

Violation periods (non-HPV) are labeled  “Violation Identified” to indicate that a violation was identified during the displayed time period. Subsequent periods in which violations remain unresolved, based on the lack of a Resolved Date in ICIS-Air, are labeled “Violation-Unresolved” to indicate that one or more violations are unresolved but not newly identified. 

Important Information about High Priority and Federally Reportable Violation Data: 

- “High Priority Violation” (HPV) represents an HPV that has been reported by a state/local delegated authority. The HPV policy is intended for delegated agency use and such classification of state/local reported violations does not apply to EPA alleged violations. EPA has different ways of tracking its compliance and enforcement work.
- “Violation Identified” represents a Federally Reportable Violation (FRV) that has been reported by a state/local delegated authority. The FRV policy is intended for delegated agency use and such classification of state/local reported violations does not apply to EPA alleged violations. EPA has different ways of tracking its compliance and enforcement work.
- “No Violation Identified” is an indication that no new HPV or FRV has been discovered in that month or quarter by a state/local delegated authority. It does not mean that the facility is currently in compliance with all applicable requirements. The HPV/FRV policies are intended for delegated agency use and such classification of state/local reported violations does not apply to EPA alleged violations. Also, EPA has different ways of tracking its compliance and enforcement work.

FRV Dates

EPA requests state and local environmental agencies provide data associated with Federally Reportable Violations (FRVs) that is thereafter displayed in ECHO. These agencies submit data in accordance with minimum EPA requirements. In so doing, these agencies have varied processes for how they provide such information. To accommodate for this variation in FRV reporting, EPA has updated the ECHO display of data to allow the states/locals to choose to report FRVs consistent with one of the following approaches:

- Agencies use the FRV Determination Date and the Resolved Date to display an FRV date range in ECHO. These include Alabama, Florida, Massachusetts, Georgia, and North Carolina.
- Agencies use the FRV Determination Date to display in ECHO the date when the FRV was identified. These include all other state and local agencies.

Notice About Duration of Violations: The duration of violations shown on this report is an estimate of the actual duration of the violations that might be alleged or later determined in a legal proceeding. For example, the start date of the violation as shown in the ECHO database is normally when the government first became aware of the violation, not the first date that the violation occurred, and the facility may have corrected the violation before the end date shown. In some situations, violations may have been corrected by the facility, but EPA or the State has not verified the correction of these violations. In other situations, EPA does not remove the violation flag until an enforcement action has been resolved.

| CAA Violation Code | CAA Violation Description |
|---|---|
| V = Violation. The following codes indicate that an alleged violation of a CAA permit or regulatory program has been found by a delegated agency or the EPA. |
| V-NO SCH | In violation, no enforcement action has been issued specifying a compliance schedule |
| V-N SCH | In violation, an enforcement action has been issued, and the facility is not meeting its compliance schedule |
| V-UNKNOWN | In violation, unknown w/regard to schedule |
| V-EM&PRO | In violation, with regard to emissions and procedure (reporting requirements) |
| V-PROCED | In violation, with regard to procedural compliance (reporting requirements) |
| S = Compliance Schedule. The following code indicates that a CAA source is operating under the requirements of an enforcement schedule. |
| S-MSched | Meeting compliance schedule |
| The following codes are used in ICIS-Air as placeholders: |
| SEE Other | Present, used to avoid situations where the EPA provides a value but the state or delegated agency has not supplied a value. |
| No St Reg | No applicable state regulation. The air program is not delegated. |

### Related NPDES Permit Information

Additional information on NPDES regulated facilities may be available in the following related reports:

- CWA Pollutant Loading Report
- CWA Effluent Charts
- CWA DMR Exceedances Report
- CWA Program Area ReportsSanitary Sewer Overflow Event Report
- Biosolids Facility Report

CWA/NPDES Compliance Status 

The compliance status for National Pollutant Discharge Elimination System (NPDES) dischargers is normally determined by the electronic comparison of discharge monitoring reports (DMRs) submitted by major facilities to permitted discharge limits. Both permit limits and discharge data must be present for the system to generate an accurate compliance status. EPA's data system uses a sophisticated algorithm looking at severity and duration of violations when determining whether a facility is considered to be in Significant/Category I Noncompliance (SNC). A permit-level compliance status is generated after every quarter and then reviewed before becoming "official" as part of the "Quarterly Noncompliance Report", or QNCR.

A discharge measurement received after the last QNCR is noted as being in violation if the measurement is not within permitted limits. Discharge data shown on the Detailed Facility Report in the 13th (most recent) quarter were reported anytime after the last official quarter, and a permit-level compliance status has not yet been generated. Until the next QNCR becomes official, these data are considered draft, have not been fully quality assured, and are subject to change. The more recent data can assist ECHO users by providing more real-time information and allowing permitted facilities to see if a data error needs to be corrected. Suspected data errors can be reported by clicking on the "Report Data Error" link at the top of the Detailed Facility Report and then on the Report Error symbol next to the row of data in question.

"Violation Identified" indicates whether one or more violations occurred during a quarter. This can result from any noncompliance event or violation identified from the types described below the SNC/RNC History table.

SNC/RNC History (Significant/Category 1 Noncompliance/Reportable Noncompliance Status) - EPA's official quarterly determination of whether violations at the facility warrant EPA/state review. The codes in the table below are used on the Quarterly Noncompliance Report (QNCR) to indicate the facility's noncompliance (SNC/Category I or RNC/Category II) status. SNC/Category I categories are shown in RED, RNC/Category II categories are shown in ORANGE, and quarters where no violations have been identified are shown in BLUE.

Note on terminology of significant violations: The national program database calculates the severity of violations according to the Clean Water Act regulations, which have specific criteria specifying the duration, severity, and type of violations that rise to the level of Significant/Category 1 Noncompliance (SNC). SNC can occur at major facilities. The calculation of "Category I" violations is equivalent to the SNC calculations, but because the violations occur at smaller dischargers (non-major) EPA does not classify the violations as "SNC". Whether a violation is SNC or Category I has some bearing on the government response used to address the violation(s). Repeat SNC occurrences normally are addressed through formal enforcement actions, while Category I violations are often addressed via informal processes.

Facility-level (SNC/RNC) status is automatically generated based on violation data. However, state or EPA manually-entered compliance data, if present, override system-generated compliance status. If more than one code applies to a facility, a prioritization is used to determine which code appears for the overall facility status. The order of precedence from most to least important is as follows:

| Priority | Violation Status | CWA Category | CWA Description |
|---|---|---|---|
| 1 | Compliance/Permit Schedule - Violations | SNC/Category I Noncompliance | Enforcement action or permit compliance schedule event violation - more than 90 days late. |
| 2 | Effluent - Monthly Average Limit | SNC/Category I Noncompliance | Effluent violations of monthly average limits (Technical Review Criteria and chronic) or SNC-level single event violation. |
| 3 | Effluent - Non-monthly Average Limit | SNC/Category I Noncompliance | Effluent violations of non-monthly average limits (Technical Review Criteria and chronic). |
| 4 | Compliance/Permit Schedule - Reporting | SNC/Category I Noncompliance | Enforcement action or permit compliance report violation - more than 30 days late. |
| 5 | Failure to Report DMR - Not Received | SNC/Category I Noncompliance | Reporting violation - non-receipt of DMR. Note: For non-major facilities, the system replaced "D" (non-receipt of DMR) with "W", except for facilities in Arkansas and Louisiana, for monitoring period end dates before July 1, 2017. |
| 6 | Reportable Noncompliance | Violation Identified | Reportable noncompliance. |
| 7 | Resolved - Pending | No Violation Identified | An enforcement action has been issued, and facility compliance with the action is pending final completion. |
| 8 | Resolved | No Violation Identified | The facility has returned to compliance with its permit conditions, either with or without issuance of an enforcement action. |
| 9 | Other Violations | Violation Identified | The facility has effluent, compliance schedule, permit schedule, or single-event violations in the current quarter; however, is not considered to be in RNC or SNC. |
| N/A | Undetermined | Unknown | EPA's data system is not able to determine the facility-level compliance status because the system has not been set to track it or because the data haven't been entered. This information may be available from a state database. |
| N/A | N/A | Not Applicable | Compliance status does not apply to permits with a status of "Pending", "Not Needed", or "Terminated", or with a permit type of "Unpermitted". |

1. Effluent Violations

For effluent violations on Discharge Monitoring Reports (DMRs), the NPDES program system (ICIS-NPDES) determines effluent exceedance violations and calculates the percent the DMR reported value exceeded the permit limit. Effluent Violations by Pollutant (NPDES Parameter) are listed for which the facility has exceeded its permitted limit once or more during the three year period. Effluent exceedances are listed for the NPDES Parameter by Discharge Point (Disch Point) (a.k.a. outfall or pipe). Only violating parameters are shown. This field also includes a Limit Set Designator, an alphanumeric code in ICIS-NPDES that is used to designate a particular grouping of parameters within a limit set. Note: Discharge data shown in the 13th (most recent) quarter were reported anytime after the last official quarter and are considered draft.

Effluent violations are indicated by displaying the highest percentage by which the permit limit was exceeded for the month or quarter, based on the DMR monitoring period end date. At times, the percent exceedance calculated is "2,147,483,650" or "99,999" percent, but the Detailed Facility Report will display "LIMIT VIOLATION" because these values are not representative of the actual measured percent exceedance and should not be interpreted this way. Although these data no longer appear on ECHO reports, users of the downloadable datasets should be aware of this issue. (Updated December 2018.)

Bold, large red print indicates Significant/Category 1 Noncompliance (SNC) effluent violations. Bold, large black print indicates RNC violations. For unresolved SNC or RNC violations (e.g., violations with no government action against the facility), the table cell is shaded gray. Significant/Category I noncompliant effluent violations that occurred before the three year period that remain unresolved are displayed in Quarter 1 and include the oldest monitoring period end date and highest percentage by which the permit limit was exceeded for the month or quarter.  Note: the highest percent exceedance for a quarter will display as grey if an effluent violation within the quarter is unresolved and is not the highest percent exceedance. It is possible for a facility to have effluent violations that do not rise to the SNC/RNC level. This occurs if the exceedances are not significantly over permit limits.

Monitoring Location: The location at which the monitoring requirement applies. For a list of possible monitoring locations, please see the ICIS-NPDES DMR Summary page. 

Frequency (Freq):  To the right of each parameter/chemical shown with a limit exceedance, there is an indicator of what type of measurement was used to determine the violation.

- "Mnthly" stands for monthly. This means that the exceedance shown in that row was based upon a monthly average of readings submitted by the permittee. EPA generally believes that monthly averages are the most important, because the exceedance represents an average of many readings.
- "NMth" stands for non-monthly. This is generally a "maximum" amount read during the reporting period (and could indicate a spike that is not continuous). "Neither" denotes other measurements such as a minimum (e.g., pH could be in violation if below the permitted level). Please note that the exceedances shown in the table are the "worst" value within the selected timeframe. Generally the permittee will report three times within the quarter (each month).

Technical Review Criteria (TRC)  violations are those which exceed or equal the product of Technical Review Criteria (TRC) times the effluent limit and occur two months in a six-month period. This applies for Group 1 and Group 2 pollutants. Group 1 pollutants have TRC = 1.4 and Group 2 pollutant have TRC =1.2.

1b. Benchmark Threshold Exceedances (No violation): Pollutant 

Benchmark Threshold Exceedances by Pollutant (NPDES Parameter) are listed for which the facility has exceeded its benchmark threshold once or more during the twelve listed quarters. Benchmark monitoring is required under the 2015 EPA Multi-Sector General Permit as an indicator of performance of stormwater control measures. Benchmark threshold exceedances indicate instances when stormwater pollutant concentrations exceed levels that could adversely affect receiving water quality, and require permittees to review their stormwater control measures and take corrective action. These exceedances are not violations, but rather indicators of potential problems at the site. For more information on benchmark monitoring, see the Industrial Stormwater Monitoring and Sample Guide under the EPA MSGP Fact Sheets and Guidance tab. Please note that any facility action to address exceedances is not displayed on ECHO. A summary of the past year's corrective actions are included in a facility's MSGP Annual Report. Annual Report data will be added to ECHO as part of NPDES eReporting Rule implementation.

Benchmark threshold exceedances are listed for the NPDES Parameter by Discharge Point (Disch Point). Only parameters which have exceeded the benchmark threshold are shown. Exceedances are indicated by displaying the highest percentage by which the benchmark threshold was exceeded for the quarter. This field also includes a Limit Set Designator, an alphanumeric code in ICIS-NPDES that is used to designate a particular grouping of parameters within a limit set. Note: Discharge data shown in the 13th (most recent) quarter were reported anytime after the last official quarter and are considered draft.

Frequency (Freq): To the right of each parameter/chemical shown with a limit exceedance, there is an indicator of what type of measurement was used to determine the exceedance.

- "Mnthly" stands for monthly. This means that the exceedance shown in that row was based upon a monthly average of readings submitted by the permittee. EPA generally believes that monthly averages are the most important, because the exceedance represents an average of many readings.
- "NMth" stands for non-monthly. This is generally a "maximum" amount read during the reporting period (and could indicate a spike that is not continuous). "Neither" denotes other measurements such as a minimum (e.g., pH could be in violation if below the permitted level). Please note that the exceedances shown in the table are the "worst" value within the quarter. Generally the permittee will report three times within the quarter (each month)

2. Compliance or Permit Schedule Violations

If a facility has been issued an enforcement action and is on a compliance schedule, all noncompliance events related to violations of that schedule in the past three years are listed under the Compliance Schedule Violations section with an associated Violation ID. 

Schedule violations are listed with the violation start date (event due date) and return-to-compliance dates across the thirteen quarters. A right arrow displays in the time periods between the two dates. A report showing a right arrow with no closing date means that the violation has not been resolved and continues to be active in the data system. If the violation started before the last three years of data and continues into the last three years, the beginning date is listed in QTR1. The most recent official quarter for ICIS-NPDES is usually available 2 1/2 months after the quarter has ended.

Bold, large red print indicates Significant/Category 1 Noncompliance (SNC) violations. Bold, large black print indicates RNC violations. For unresolved SNC or RNC violations (e.g., violations with no government action against the facility), the table cell is shaded gray.

ICIS-NPDES automatically generates schedule violations against permit and compliance schedules based on the achievement dates in each scheduled event. A schedule event requires the completion of an activity such as initiations of construction or completion of construction. There are four types of schedule event violations:

- C10: Reported Late (least severe): The schedule report received date is more than 14 days after the schedule date. This violation does not appear on QNCR.
- C20: Achieved Late but Reported: The schedule actual date is greater than the schedule date. This violation does not appear on QNCR.
- C30: Unachieved but Reported: The schedule report received date has been entered, but the schedule action date has not been entered and the current date is more than 30 days after the schedule date.
- C40: Unachieved and Not Reported (most severe): The schedule actual date and schedule report received date are blank and the current date is more than 30 days past the schedule date.

While facility-level compliance status and effluent violations are displayed based on that schedule, compliance schedule violations are displayed as they are reported. Therefore, occasionally the compliance schedule event date will fall outside the date range of the final quarter displayed. For ICIS-NPDES data, please note that violations on the same day may be related to each other. For example, a violation for failure to file a report may be followed by a violation for late filing, which could be followed by a violation for failure to achieve schedule. 

3. Single Event Violations

If the facility is identified as being in violation of CWA requirements, but this violation is not captured in the effluent violation, compliance or permit schedule violation, or late or missing discharge monitoring report (DMR) sections, this violation is presented in the section titled Single Event Violations. Single event violations are often the result of inspection findings. Text descriptions of the violation(s) are presented below the section heading (e.g., DISCHARGE WITHOUT A VALID PERMIT). If the facility has no single event violations in the past three years, this section is not presented. If the single event violation has been entered after the permit level-compliance status has been generated as part of the Quarterly Noncompliance Report, which is run about two and a half months after the end of the quarter, this change will not be reflected in the facility-level status. However, the date and description of each single event violation is listed in the table.

Single event violations are listed with the violation start date and return-to-compliance dates across the thirteen quarters. A right arrow displays in the time periods between the two dates. A report showing a right arrow with no closing date means that the violation has not been resolved and continues to be active in the data system. If the violation started before the last three years of data and continues into the last three years, the beginning date is listed in QTR1. If the violation does not have an end date but has a RNC resolution code, the resolution date becomes the violation end date. 

Bold, large red print indicates Significant/Category 1 Noncompliance (SNC) violations. Bold, large black print indicates RNC violations. For unresolved SNC or RNC violations (e.g., violations with no government action against the facility), the table cell is shaded gray. 

4. Late or Missing Discharge Monitoring Report (DMR) Measurements

If a CWA facility submitted DMRs to the NPDES permitting authority late or did not submit DMR measurements (e.g., non-receipt) during a particular month or quarter, the number of these violations are listed in separate rows in the Three-Year Compliance History table based on the DMR monitoring period end date. The counts are hyperlinked to a separate report page that presents detailed information on each non-receipt violation in a table (one violation per row). 

In ICIS-NPDES, a no data indicator (NODI) code indicates the reason that data for an expected DMR value were not submitted by the permittee for a Monitoring Period End Date. If a noncompliant NODI code is entered, it will be considered “Missing”, regardless of when it was submitted.

Entire missing DMRs that are unresolved at the end of a quarter can generate a "Failure to Report DMR - Not Received" permit status. These violations remain unresolved for two years unless the DMRs are submitted or action was taken by the regulatory authority. In instances where a permit has a status of "Failure to Report DMR - Not Received" but has no missing or late DMRs that occurred during the quarter, it is the result of entire missing DMRs from the previous two years that were unresolved at the end of the quarter.   

RCRA Compliance Status 

All reported noncompliance events that would cause the RCRA site to be in noncompliance at some time in the past three years are listed under the Violation section. A RCRA site is considered out of compliance for any month/quarter in which there is a violation date and no corresponding return-to-compliance date and is considered out of compliance until there is a return-to-compliance date. Violations are listed with both the determined and return-to-compliance dates. A report showing a right arrow with no closing date (e.g., →) means that the facility has not been returned to compliance and continues to be active in the national program data system. If the violation started before the last three years of data and continues into the last three years, the beginning date is listed in QTR1/Month 1.

At the Facility Level Status, a site can be designated as "Significant Noncomplier", "Violation Identified", or "Violation". Some hazardous waste facilities have activities in multiple states. When the SNC activity location is not the same as the state where the facility is located, the state of the SNC activity location is displayed in parentheses. It is possible for the facility to have a SNC activity location in more than one state.

Evaluation: If an environmental agency conducted a compliance evaluation and identified violations, the compliance status is listed as a row in the Evaluation section. The start date of the period of noncompliance corresponds to the date of the compliance evaluation, which will be listed the Compliance Monitoring History table.

A RCRA site is considered to be a Significant Noncomplier in the most recent compliance quarter of record when there is actual exposure or a substantial likelihood of exposure to hazardous waste/constituents, is a chronic or recalcitrant violator; or a substantial deviation from the terms of a permit, order, agreement, or RCRA statutory or regulatory requirements.

Violation: The RCRAInfo system uses codes that designate many different types of violation, depending on both the type of facility and the part of the site that had the violation. The violation types are nationally defined and the short description provided both indicates the type of violation that allegedly occurred and links to the corresponding Violation Report. RCRA violation types are listed in the Nationally Defined Values for Violation Type (PDF) (7 pp, 16 K, About PDF); from the source data system, RCRAInfo.

Agency: The state environmental agency or EPA. For a list of state environmental agency websites, see Access State Websites.

Data Quality Alert - If a violation was entered into the national program data system many years ago but a return-to-compliance date has not been entered by the EPA or state, the violation will continue to appear on this report. If you suspect a resolved violation needs a return-to-compliance date, please report the suspected error.

SDWA Compliance Status 

States report information about SDWA violations quarterly to EPA. After a violation has been reported, there is typically a three-to-six month review period before the official quarterly status of the PWS is updated. The most recent "official" compliance status is displayed in the 12th quarter on the Detailed Facility Report. If states have provided new violation information for the next quarter, these violations are displayed in the 13th quarter. Until the next quarter becomes official, these data are considered draft, have not been fully quality assured, and are subject to change. The more recent data can assist ECHO users by providing more real-time information and allowing permitted systems to see if a data error needs to be corrected. Suspected data errors can be reported by clicking on the "Report Data Error" link at the top of the Detailed Facility Report and then on the Report Error symbol next to the data in question.

Violations are listed with both the beginning and return-to-compliance dates across the table. For violations with a defined noncompliance period, the violation period is displayed using the noncompliance period start and end dates. Open-ended violations (violations without a noncompliance period end date) are listed using the later resolving action date, if the earlier resolving action is followed by certain types of enforcement actions that indicate continued enforcement activity. A report showing a right arrow with no closing date (e.g., →) means that the violation has not been resolved and continues to be active in the program data system. If the violation started before the last three years of data and continues into the last three years, the beginning date is listed in QTR1.

Select the hyperlink on the date or date range to jump to the violation record in the SDWA Violations and Enforcement Actions (5 Years) table. 

One or more of the following descriptions may apply to a given system.

- Enforcement priority - A public water system with unresolved serious, multiple, and/or continuing violations, as identified by the quarterly application of EPA's Drinking Water Enforcement Response Policy (PDF)(16 pp, 952 K, About PDF ), that must either return to compliance or be addressed by a formal enforcement action within six months. EPA designates enforcement priority so that the drinking water system and the primacy agency will act quickly to resolve the most significant drinking water violations. Many public water systems with violations, however, are not designated as enforcement priority systems. Operators and the primacy agencies are expected to correct the violations at non-enforcement priority violators as well, but without imposition of the deadlines applicable to enforcement priority violators. If the violations at a non-enforcement priority violator are left uncorrected, that system may become an enforcement priority. When an enforcement priority violator has returned to compliance or has been addressed by a formal enforcement action, it is no longer designated an enforcement priority violator. EPA updates its enforcement priority violator list on a quarterly basis.
- Category - Specifies the type of violation. The user can hover over the abbreviated category name in the table to view the full category name.Health-based violations (MCL, MRDL, TT) - Violations of maximum contaminant levels (MCLs) or maximum residual disinfectant levels (MRDLs), which specify the highest concentrations of contaminants or disinfectants, respectively, allowed in drinking water; or of treatment technique (TT) rules, which specify required processes intended to reduce the amounts of contaminants in drinking water. MCLs, MRDLs, and treatment technique rules are all health-based drinking water standards.
- Monitoring and reporting violations (MR, MON) - Failure to conduct regular monitoring of drinking water quality, as required by SDWA, or to submit monitoring results in a timely fashion to the primacy agency.
- Public notice violations (Other) - Violations of the public notification requirements of SDWA, which require systems to immediately alert consumers if there is a serious problem with their drinking water that may pose a risk to public health.
- Other violations (Other)- Violations of other requirements of SDWA, such as issuing annual consumer confidence reports or maintaining required records.
- Violation TypeLists the specific violation within the category. E.g, a maximum contaminant level (MCL) exceedance of arsenic would list "MCL" for category and "Arsenic" for violation type.
- Violation-Addressed - Violations that have been addressed by one or more formal enforcement actions.
- No violations - EPA does not know of any unresolved violations for this system.
- In Progress - A compliance status has not yet been generated for the 13th (most recent) quarter. Data were reported after the last official quarter and are considered draft, have not been fully quality assured, and are subject to change.

The SDWA Compliance Data Last Reported is the SDWA "Current As Of" date for the state, which is the latest of either (1) the last day of the current official (12th) quarter, or (2) any site visit date, violation noncompliance period begin date, or enforcement action date.

Top of Page

#### Informal Enforcement Actions

The Informal Enforcement Actions section of the Detailed Facility Report displays the informal enforcement actions that have been entered into national data systems for each facility over the past five or ten years, with five as the default. Typically used to address less serious violations, an EPA informal action must meet all the following criteria:

- Is issued by the regulatory agency in writing (paper or electronic) to the regulated entity,
- Is issued as a result of a “potential finding of violation” or a finding of violation, or a self-disclosure,
- Contains a description of the legal and factual basis for the possible action and states with reasonable specificity the nature of the potential finding of violation or finding of violation,
- Includes either:For self-disclosures only, where there is a potential finding of violation, an acknowledgement that the discloser has certified that the violation has been corrected (i.e., Acknowledgement Letter), or
- For non-self disclosures:A statement that the regulated entity should take whatever action(s) is necessary to correct the potential finding of violation or finding of violation,
- A recommended reasonable timeframe for completing and/or reporting, as appropriate, either any necessary actions to correct the potential finding of violation or finding of violation expressed in specific terms (e.g., within 45 days of receipt of this action or prior to the next permit reporting deadline), or a demonstration by the recipient that there is no such violation; and
- A statement describing the steps the regulatory agency “may” take or “is prepared to” take with respect to the potential finding of violation or finding of violation
- Is not independently enforceable,
- Is not an action established by law or regulation by which the regulatory agency may itself impose or seek through a court or other tribunal, a sanction (e.g., a penalty) or injunctive relief for the identified violation, obtain compliance or abate the endangerment, or resolve liability.

Statute

Identifies the environmental statute associated with each of the permits and identifiers linked to the facility:

- AIM - American Innovation and Manufacturing Act
- CAA — Clean Air Act
- CWA — Clean Water Act
- RCRA — Resource Conservation and Recovery Act
- TSCA — Toxic Substances Control Act
- EP313 — Emergency Planning and Community Right-to-Know Act, Section 313 (i.e., the Toxics Release Inventory (TRI) program)
- FIFRA — Federal Insecticide, Fungicide, and Rodenticide Act
- SDWA — Safe Drinking Water Act

System

Identifies the source database of the informal enforcement action:

| Acronym | Data System |
|---|---|
| ICIS-Air | ICIS-Air |
| ICIS | ICIS Federal Enforcement and Compliance (ICIS FE&C) |
| ICIS-NPDES | ICIS National Pollutant Discharge Elimination System (ICIS-NPDES) |
| RCRAInfo | Resource Conservation and Recovery Act Information System (RCRAInfo) |
| SDWIS | Safe Drinking Water Information System |
| OTHER | Other database |

Source ID

An alphanumeric field, which is a unique value for each record/permit/site within each data system. These identifiers are for tracking purposes in the individual data systems.

Type of Action

The table below lists the main types of informal enforcement action that may be displayed in this section. The type of action and description are designated differently in each EPA data system, but may be equivalent. For the CWA, this column displays both the program type and informal enforcement action type descriptions. CWA program types are listed after the table below.

Additional informal action types from ICIS-Air, ICIS-NPDES, or RCRAInfo not listed in the table below will be italicized on the DFR. These informal action types are not included in ECHO facility searches or results.

| Statute | Acronym | Informal Action |
|---|---|---|
| CAA Stationary Source | DAWL | Warning Letter |
| CAA Stationary Source | LREO | Letter to Regulated Entity |
| CAA Stationary Source | SCL | Show Cause Letter |
| CAA, CWA, and others | LOVWL | Letter of Violation/Warning Letter |
| CAA, CWA, and others | NOV | Notice of Violation |
| CAA, CWA, and others | NONC | Notice of Noncompliance Issued |
| RCRA Hazardous Waste | 115 | Warning Letter (applies to actions taken by Alabama, Kentucky, and North Carolina) |
| RCRA Hazardous Waste | 120 | Written Informal |
| RCRA Hazardous Waste | 126 | Warning Letter (applies to actions by Tennessee) |
| RCRA Hazardous Waste | 130 | Notice of Determination |
| RCRA Hazardous Waste | 140 | Letter Of Intent To Initiate Enforcement Action |

RCRA Hazardous Waste Program Note: The types of action noted above are nationally defined by EPA. Other types of action that may be shown in the Detailed Facility Report are defined and maintained by EPA regions or state agencies. RCRA enforcement action types are further described in the Nationally Defined Values for Enforcement Type (PDF) (3 pp, 12 K, About PDF) from the source data system, RCRAInfo. 

CWA Program Type Descriptions (Clean Water Act):             CWA program types include:

- Pesticide Application
- Construction Stormwater
- Core Program
- FRP
- Urban Stormwater (MS4)
- Industrial Stormwater
- OPA
- Pretreatment
- SSO
- CSO
- 308 Information Request
- Biosolids
- CAFO
- Base Program
- Emergency Actions
- Spills
- Other Unpermitted Discharges
- Wetlands
- Administrative Compliance Order
- Post Administrative Penalty Case
- SPCC

SDWA Informal Enforcement Actions  (Safe Drinking Water Information System):An enforcement action that is intended to bring a system back into compliance, but doesn’t meet the definition of a formal action. Informal enforcement actions include notices of violation, site visits, compliance meetings, injunctions, and public notifications. SDWA informal enforcement action types include:

- St/Fed Boil Water Order
- St Case appealed
- St Case dropped
- St/Fed CCR Follow-up Notice
- St Civil Case under development
- St/Fed Compliance Meeting conducted
- St/Fed Default Judgment
- St/Fed Formal NOV issued
- St Hook-up/Extension Ban
- St/Fed Injunction
- St Intentional no-action
- St/Fed No additional Formal Action needed
- St/Fed Other
- St/Fed Public Notif issued
- St/Fed Public Notif received
- St/Fed Public Notif requested
- St/Fed Show-cause Hearing
- St/Fed Site Visit (enforcement)
- St/Fed Tech Assistance Visit
- St/Fed Temp Restrain Order/Prelim Injunc
- St/Fed Turbidity Waiver issued
- St/Fed Unresolved
- St/Fed Variance/Exemption issued
- St/Fed Violation/Reminder Notice
- Referred for Higher St/Fed Level Review

Lead Agency

The lead agency responsible for issuing the notice of violation.

Date

The date of the notice of violation or informal enforcement within the last five years.

Top of Page

#### Formal Enforcement Actions

#### Additional EPA Case Information

- Enforcement Basic Information
- EPA Administrative Settlements
- EPA Civil Cases and Settlements

The Formal Enforcement Actions section of the Detailed Facility Report provides the federal and state formal enforcement actions that have been entered into national data systems for each facility over the past five or ten years (including data from the twenty most recently completed quarters, plus data from the current quarter up until the refresh date). Typically used to address more serious violations and may be independently enforceable, an EPA formal action must meet the following criteria: 

- Is issued by the regulatory agency in writing (paper or electronic) to the regulated entity,
- Is issued as a result of a “finding of violation”, a “finding of endangerment”, or a self-disclosure,
- Contains a description of the legal and factual basis for the action and states with reasonable specificity the nature of the finding of violation, and for self-disclosure only, where there is a finding of violation, includes notice that the discloser has certified that the violation has been corrected (e.g., electronic Notice of Determination),
- Is an action established by law or regulation by which the regulatory agency may itself impose or seek through a court or other tribunal, a sanction (e.g., a penalty) or injunctive relief for the identified finding of violation, obtain compliance or abate the endangerment, or use to resolve liability (e.g., FIFRA Notices of Warning, Federal Facility Compliance Agreement).

The Formal Enforcement Actions section generally does not include data regarding enforcement referrals or criminal enforcement actions. In some cases, referrals may be displayed after they are linked to a final action.

Note that a civil enforcement case from ICIS, or a "Multi-Site Super CA/FO" from RCRAInfo, may involve more than one facility. In such a situation, the penalties, SEP value, and complying action cost may apply to the case as a whole and not just to the facility. Click on the case number for more information.

Statute

Designation of the primary statute associated with the case and cited in the action:

- AIM - American Innovation and Manufacturing Act
- CAA — Clean Air Act
- CWA — Clean Water Act
- RCRA — Resource Conservation and Recovery Act
- CERCLA — Comprehensive Environmental Response, Compensation, and Liability Act (Superfund)
- EP313 — Emergency Planning and Community Right-to-Know Act, Section 313 (i.e., the Toxics Release Inventory (TRI) program)
- TSCA — Toxic Substances Control Act
- FIFRA — Federal Insecticide, Fungicide, and Rodenticide Act
- SDWA — Safe Drinking Water Act
- MPRSA — Marine Protection, Research, and Sanctuaries Act

System

Identifies the source database of the formal enforcement action:

| Acronym | Data System |
|---|---|
| ICIS-Air | ICIS-Air |
| ICIS | ICIS Federal Enforcement and Compliance (ICIS FE&C) |
| ICIS-NPDES | ICIS National Pollutant Discharge Elimination System (ICIS-NPDES) |
| RCRAInfo | Resource Conservation and Recovery Act Information System (RCRAInfo) |
| SDWIS | Safe Drinking Water Information System |
| OTHER | Other database |

Law/Section

Identifies the primary statute/law and section violated and cited in the enforcement action. Many of EPA's judicial actions are based on incidents that are violations of more than one statute. One law entered into the ICIS record is designated the primary law, which is considered the law that is most seriously violated and/or for which the most significant relief is sought. For civil enforcement cases, a list of possible Statute Codes (Law), Law Section Codes, and Law Section description combinations is available here (11 pp, 365 K, About PDF ).

Source ID

An alphanumeric field, which is a unique value for each record/permit/site within each data system. These identifiers are for tracking purposes in the individual data systems.

Action Type

Text description of the type of enforcement action. The type of action and description are designated differently in each system, but may be equivalent.

CWA Formal Enforcement Actions             All CWA enforcement actions considered judicial or formal administration cases are included. The numerals appearing after the enforcement action type are not a part of the enforcement action. These numbers describe the type of action (i.e., judicial, administrative, etc.) and are included with the text description of the action.

CAA and RCRA Formal Enforcement Actions              

| Statute | Acronym | Formal Action |
|---|---|---|
| CAA | SCAAAO | Administrative Order |
| CAA | CIV | Civil Judicial Action |
| RCRA | 210 | Initial 3008(a) Compliance Order |
| RCRA | 220 | Initial Imminent and Substantial Endangerment Order |
| RCRA | 230 | Initial Monitoring, Analysis, Test Order |
| RCRA | 240 | Initial 3008(h) I.S. CA Order |
| RCRA | 250 | Field Citation |
| RCRA | 310 | Final 3008(a) Compliance Order |
| RCRA | 320 | Final Imminent Hazard Order |
| RCRA | 330 | Final Monitoring, Analysis, Test Order |
| RCRA | 340 | Final 3008(h) I.S. CA Order |
| RCRA | 380 | Multi Site Super CA/FO |
| RCRA | 385 | Single Site Super CA/FO |
| RCRA | 410 | Referral to Attorney General |
| RCRA | 420 | Referral to Department of Justice |
| RCRA | 425 | Referral to DOJ to Collect Penalties |
| RCRA | 430 | Referral to District Attorney/City Attorney/County Attorney/State Attorney |
| RCRA | 510 | Initial Civil Judicial Action for Compliance and/or Monetary Penalty |
| RCRA | 520 | Initial Civil Action for Imminent and Substantial Endangerment |
| RCRA | 530 | Initial Judicial Action for Corrective Action |
| RCRA | 610 | Final Civil Judicial Action for Compliance and/or Monetary Penalty |
| RCRA | 620 | Final Civil Action for Imminent and Substantial Endangerment |
| RCRA | 630 | Final Civil Judicial Action for Interim Corrective Action |
| RCRA | 710 | Referral to Criminal |
| RCRA | 720 | Criminal Indictment |
| RCRA | 730 | Criminal Conviction |
| RCRA | 740 | Criminal Acquittal |
| RCRA | 810 | State to EPA Administrative Referral |
| RCRA | 820 | EPA to State Administrative Referral |
| RCRA | 830 | RCRA to CERCLA Administrative Referral |
| RCRA | 840 | EPA Regions to EPA HQ Administrative Referral |
| RCRA | 850 | Administrative Referrals to Other RCRA Programs |
| RCRA | 860 | Administrative Referrals to Other Programs |
| RCRA | 865 | Referral to U.S. Treasury |

RCRA Note: The types of action noted above are nationally defined by EPA. Other types of action that may be shown in the Detailed Facility Report are defined and maintained by EPA regions or state agencies. RCRA enforcement action types are further described in the document Nationally Defined Values for Enforcement Type (PDF) (3 pp, 12 K, About PDF) from the source data system, RCRAInfo. ECHO generally focuses on concluded civil actions.             In some cases, formal enforcement actions may be entered both at the initiation and final stages of the action. These may appear more than once in the table.

SDWA Formal Enforcement Actions              An enforcement action taken to bring a noncompliant system back into compliance by a certain time, with an enforceable consequence if the schedule is not met. A formal enforcement action is based on a specific violation, requires specific actions necessary for the violator to return to compliance, and is independently enforceable without having to prove the original violation. Formal enforcement actions include issuing administrative orders, which specify actions the system must take to return to compliance; assessing fines; and referring civil or criminal cases to state attorneys general or the U.S. Department of Justice.

- EF- - Federal Complaint for Penalty Consent Order or Consent Decree
- EF/ - Federal SDWA Section 1431 (Emergency) Order
- EF

EPCRA 313, FIFRA, TSCA Formal Enforcement Actions             Any administrative or judicial action.

Case No.

A unique number identifying the enforcement action. For EPA civil cases, these numbers begin with either the two digit EPA Region Code, "HQ" (headquarters initiated cases), and "EF" or "WF" (Eastern or Western Field Office CAA Mobile Source Program cases); followed by the fiscal year. In a majority of cases, this is the year in which the action was initiated. After the fiscal year there is a sequence number. State NPDES civil cases start with the two character post abbreviation, followed by a sequence number.

A "D" icon will be displayed next to the case number if related EPA case documents (PDFs) are available. Select the "D" icon to display all related case documents. Currently, documents are limited to EPA Region 6.

Lead Agency

The lead agency responsible for the enforcement action.

Case Name

The name assigned to the case by the lead attorney. Generally, the primary defendant's name or the facility name is used as the case name.

Issued/Filed Date

For administrative cases, this field indicates the date that the complaint or Administrative Order (AO) was signed by the appropriate authority and issued to the respondent. For judicial cases, this field indicates the date that the complaint was filed with the Clerk of the Court.

Settlement/Actions

The number of final orders issued under the enforcement action. Most enforcement actions tend to follow a one-case, one-final order scenario. However, and in particular with judicial actions involving multiple defendants, more than one final order may result. Each one is presented in this section as a separate conclusion/settlement.

Note that linked settlements are listed even if they are greater than five years old. Therefore, the number of Settlements/Actions may be greater than the count of Formal Enforcement Actions listed in the Facility Summary. 

Settlement/Action Date

For federal judicial actions, this is the date the settlement document is signed by the presiding judge and entered by the Clerk of the Court. At that point, the settlement becomes a binding court order. For administrative actions, this is the date that the final order is signed and issued by the enforcement authority. Note that linked settlements that occurred earlier than the five-year window may be displayed in this table.

Federal Penalty Assessed

The total federal penalty assessed is the dollar penalty amount to be paid from all settlements in a concluded enforcement action. EPA settles the vast majority of its administrative and civil judicial enforcement actions, and these settlements (often called a consent order or consent decree) include an agreed upon penalty amount. In most of these settlements, there is not a direct admission by the defendant of liability for violations. In a few cases that involve bankruptcy, the penalty amount may be determined as an "allowed claim" in bankruptcy, and the amount actually recovered may be less than the amount of the allowed claim. The total federal penalty amount includes assessments due to both EPA and to other federal agencies that are party to the settlement, e.g., the Coast Guard.

State/Local Penalty Assessed

The total dollar penalty amount from all settlements to be paid to a state or local enforcement authority that is party to a concluded enforcement action. (For actions from System "RCR" - RCRAInfo - this is the "Final Monetary Penalty" plus "SEP Credit", if any. It doesn't include the field "Final SEP Value".) 

Penalty Amount Collected

The total penalty amount collected pursuant to a final order. Data may not be submitted to or available in all EPA source systems.

SEP Value

A Supplemental Environmental Project (SEP) is an environmentally beneficial project or activity that is not required by law, but that a defendant agrees to undertake as part of the settlement of an enforcement action. SEPs are projects or activities that go beyond what could legally be required in order for the defendant to return to compliance, and secure environmental and/or public health benefits in addition to those achieved by compliance with applicable laws. This is the net present dollar value of the proposed SEP expenditures.

Comp Action Cost

The whole dollar amount of the estimated or actual value of the complying action activities. The combination of the injunctive relief and the physical or nonphysical costs of returning to compliance. Injunctive relief represents the actions a regulated entity is ordered to undertake to achieve and maintain compliance, such as installing a new pollution control device to reduce air pollution, or preventing emissions of a pollutant in the first place. Note: CERCLA 120(e) actions refer to a Record of Decision (ROD) that provides detail for cleanup actions under the federal Superfund law; the Compliance Action Cost (Comp Action Cost) is not a penalty but rather the dollar value of the cleanup documented in the ROD.

Note: Some regulated facilities have expressed an interest in explaining data shown in the Detailed Facility Reports in ECHO. Please check company websites for such explanations.

Top of Page

#### SDWA Violations and Enforcement Actions (5 Years)

Violations 

Documents a breach of a requirement. Violations are detected by assessment of sample results or reviews (including site visits). Violations may lead to legal actions or compliance orders. Violations are publicized, when required, by public notification. Violations may be remedied by compliance/enforcement remedies, such as improved filtration techniques or changes in procedures. Examples include: Maximum Contaminant Level (MCL) violations, failure to replace lead service lines, monitoring and reporting violations, treatment technique violations, and procedural violations.             SDWA violations fall into one of the following general categories:

- Health-based violations - Violations of maximum contaminant levels (MCLs) or maximum residual disinfectant levels (MRDLs), which specify the highest concentrations of contaminants or disinfectants, respectively, allowed in drinking water; or of treatment technique (TT) rules, which specify required processes intended to reduce the amounts of contaminants in drinking water. MCLs, MRDLs, and treatment technique rules are all health-based drinking water standards.
- Monitoring and reporting (MR) violations - Failure to conduct regular monitoring of drinking water quality, as required by SDWA, or to submit monitoring results in a timely fashion to the state environmental agency or EPA.
- Public notice (PN) violations - Violations of the public notification requirements of SDWA, which require systems to immediately alert consumers if there is a serious problem with their drinking water that may pose a risk to public health.
- Other violations - Violations of other requirements of SDWA, such as issuing annual consumer confidence reports, or conducting periodic sanitary surveys.

Noncompliance Period

The time period during which a violation took place. For some violations this period corresponds to a regular water quality monitoring period, such as a month or quarter; in other cases it may initially be open-ended, and remain that way until the violation is resolved, i.e., until EPA or the state files a resolving enforcement action to indicate that either the system has returned to compliance or no further action is necessary.

Violation ID

A designated attribute which uniquely identifies the violation.

Federal Rule

The federal Safe Drinking Water Act (SDWA) rule that was violated. Note that states can issue their own rules under SDWA, to impose stricter standards or regulate contaminants not regulated by EPA. When a system violates a state rule for a contaminant that isn't regulated by EPA, the federal rule will be listed as "Not Regulated", indicating that no federal rule was violated.

The following list names the regulations enacted under SDWA. Information about all these rules is available at EPA's Drinking Water Regulations webpage and Drinking Water Rule Quick Reference Guides.

- Arsenic Rule
- Consumer Confidence Report Rule
- Filter Backwash Recycle Rule
- Ground Water Rule
- Lead and Copper Rule
- Long Term 1 Interim Enhanced Surface Water Treatment Rule
- Long Term 2 Interim Enhanced Surface Water Treatment Rule
- Miscellaneous
- Nitrates
- Not Regulated
- Other Inorganic Compounds
- Public Notice Rule
- Radionuclides Rule
- Stage 1 Disinfection By Product Rule
- Stage 2 Disinfection By Product Rule
- Synthetic Organic Compounds
- Surface Water Treatment Rule
- Total Coliform Rule
- Total Trihalomethane pre-Stage 1 DBP Rule
- Volatile Organic Compounds

Contaminant

The name of the contaminant associated with the violation, for which sample data was reported.

Category

There are several categories of violations that may be reported, which include Maximum Contaminant Level Violations (MCL), Maximum Residual Disinfectant Level (MRDL), Treatment Technique Violations (TT), and Monitoring and Reporting Violations (M/R).

Description

A description of the violation category.

Measured Value

A numeric value that represents the analytical result of a contaminant that exceeded the Maximum Contaminant Level (MCL) for that contaminant. For contaminants that can be monitored with a reliable degree of accuracy, an MCL is set. For those which cannot be monitored reliably, a treatment technique is set instead. Both standards are set at a level sufficient to protect public health.             Missing Units Caveat – The i symbol indicates that EPA does not know the units of this value, because the state did not report it. States are not required to report the units of measured values or state MCLs. Although EPA does not know the units of this value, the following information may help you to interpret the value:

- Measured values and state MCLs must be reported in the same units when they are reported to EPA. Their units may be different from the units of the federal MCL.
- State MCLs, where they exist, must always be at least as stringent as the federal MCL.

State MCL

Maximum contaminant levels (MCLs) or maximum residual disinfectant levels (MRDLs), which specify the highest concentrations of contaminants or disinfectants, respectively, allowed in drinking water. The state MCL is at least as stringent, if not more than, the federal MCL.

Federal MCL

Maximum contaminant levels (MCLs) or maximum residual disinfectant levels (MRDLs), which specify the highest concentrations of contaminants or disinfectants, respectively, allowed in drinking water; or of treatment technique (TT) rules, which specify required processes intended to reduce the amounts of contaminants in drinking water. MCLs, MRDLs, and treatment technique rules are all health-based drinking water standards.

Status

Describes the status of the drinking water violation. SDWA violation statuses include:

- Resolved - The violation has at least one resolving enforcement action. In SDWIS, this indicates that either the system has returned to compliance from the violation, the rule that was violated was no longer applicable, or no further action was needed.
- Archived - The system that the violation is associated with has either been deactivated, or the noncompliance period end date has been entered for the violation and the noncompliance period end date is less than the greatest violation date, enforcement action date, or site visit date reported by the PWSID's Primary Agency in the SDWA data release for the current quarter. In keeping with the Enforcement Response Policy, the violation no longer contributes to the public water system's overall compliance status.
- Addressed - The violation is not Resolved or Archived, and is addressed by one or more formal enforcement actions.
- Unaddressed - The violation is not Resolved or Archived, and has not been addressed by formal enforcement.

Enforcement Actions

Enforcement actions taken by EPA or the states in response to violations of SDWA.

Date

The calendar date (MM/DD/YYYY) the enforcement action was taken.

Category

Enforcement actions taken by EPA or the states in response to violations of SDWA may be classified into the following categories:

- Formal enforcement action An enforcement action taken to bring a noncompliant system back into compliance by a certain time, with an enforceable consequence if the schedule is not met. A formal enforcement action is based on a specific violation, requires specific actions necessary for the violator to return to compliance, and is independently enforceable without having to prove the original violation. Formal enforcement actions include issuing administrative orders, which specify actions the system must take to return to compliance; assessing fines; and referring civil or criminal cases to state attorneys general or the U.S. Department of Justice.
- Informal enforcement action An enforcement action that is intended to bring a system back into compliance, but falls short of a formal action. Informal enforcement actions include notices of violation, site visits, compliance meetings, injunctions, and public notifications.
- Resolving enforcement action A determination that a violation has been resolved, because either the system has returned to compliance, the rule is no longer applicable, or no further action is needed.

Description

A description of the enforcement action.

Agency

The lead agency that conducted the enforcement action.

Top of Page

#### Environmental Conditions The Environmental Conditions section of the Detailed Facility Report Describes the health of the environment in which the facility resides (i.e., water quality and air quality conditions).Watershed(s) Table

12-Digit WBD HUC (RAD)

The 12-digit Hydrologic Unit Code (HUC) of the watershed in which the facility resides, based on the USGS Watershed Boundary Dataset (WBD). A HUC number is assigned to every watershed in the nation and uniquely identifies the watershed.

WBD Subwatershed Name (RAD)

The name of the watershed in which the facility resides. This is the watershed name that is associated with the WBD HUC 12.

State Water Body Name (ICIS)

The name of the river, lake, stream, or estuary in which the facility discharges wastewater. This is the state water body name or names as entered into EPA's ICIS-NPDES data system. The authorized NPDES program manually creates these names for each permitted feature at the facility and enters or shares these data with ICIS-NPDES.

Beach Closures Within Last Year

Displays "Yes" if the facility is located on or near a water body with a beach closure within the last year. This association is derived in ECHO by matching the WBD12 of the beach with the WBD12 of the NPDES facility location. Visit EPA's Beaches webpage for more information about beach water quality monitoring.

Beach Closures Within Last Two Years

Displays "Yes" if the facility is located on or near a water body with a beach closure within the last two years. This association is derived in ECHO by matching the WBD12 of the beach with the WBD12 of the NPDES facility location. Visit EPA's Beaches webpage for more information about beach water quality monitoring.

Pollutants Potentially Related to Impairment

Lists all pollutants in the NPDES permit that may be potentially contributing to water body impairment, derived from an association to impaired cause groups in the ATTAINS database.

Watershed with ESA-listed Aquatic Species?

Displays "Yes" if the watershed contains Endangered Species Act (ESA)-listed aquatic species. ESA-listed aquatic species are a group of organisms that live in the water for most or all of its life and are designated as threatened or endangered under the Endangered Species Act. The purpose of the ESA is to protect and recover imperiled species and the ecosystems upon which they depend. It is administered by the U.S. Fish and Wildlife Service and the Commerce Department's National Marine Fisheries Service (NMFS). 

Assessed Waters From Latest State Submission (ATTAINS)

State

The state in which the water body is located.

Report Cycle

Year that the report was created or updated.

Assessment Unit ID

Unique identifier identifying the segment of a water body that has been evaluated for pollution. 

Assessment Unit Name

Name of the assessment unit located near the facility. An assessment unit is a segment of a water body that has been evaluated for pollution, as indicated in How's My Waterway?. 

Water Condition

States the current water condition of the water body segment on which the facility resides. The water body segment is listed as:

- Unknown if the current status of the water body segment is unknown.
- Impaired if the water body segment has been identified as impaired.
- Impaired - 303(d) listed if the water body segment has been identified as impaired and reported to EPA. Visit EPA's Impaired Water and TMDLs webpage for more information about 303(d) listings of impaired waters.

Cause Groups Impaired

Lists all groups of pollutants or stressors that are causing impairment in the assessed water body, as indicated in ATTAINS database.

Drinking Water Use

Displays the following descriptions:

- Insufficient Information if a conclusion cannot be made whether the water body segment in which the facility resides is designated for drinking water use.
- Not Supporting if the water body segment in which the facility resides is not designated for drinking water use.
- Fully Supporting if the water body segment in which the facility resides is designated for drinking water use.
- Not Assessed if the water body segment in which the facility resides has not been assessed for drinking water use.
- "--" if the use group has not been assigned to the water by the state. This generally is considered to mean the state did not assess the water for this designated use, but did not specifically report it as "Not Assessed." This occurs most commonly when the designated use does not apply to the water.

The data are from the ATTAINS database.

Ecological Use

Displays the following descriptions:

- Insufficient Information if a conclusion cannot be made whether the water body segment in which the facility resides is designated for ecological use.
- Not Supporting if the water body segment in which the facility resides is not designated for ecological use.
- Fully Supporting if the water body segment in which the facility resides is designated for ecological use.
- Not Assessed if the water body segment in which the facility resides has not been assessed for ecological use.
- "--" if the use group has not been assigned to the water by the state. This generally is considered to mean the state did not assess the water for this designated use, but did not specifically report it as "Not Assessed." This occurs most commonly when the designated use does not apply to the water.

The data are from the ATTAINS database.

Fish Consumption Use

Displays the following descriptions:

- Insufficient Information if a conclusion cannot be made whether the water body segment in which the facility resides is designated for fish consumption use.
- Not Supporting if the water body segment in which the facility resides is not designated for fish consumption use.
- Fully Supporting if the water body segment in which the facility resides is designated for fish consumption use.
- Not Assessed if the water body segment in which the facility resides has not been assessed for fish consumption use.
- "--" if the use group has not been assigned to the water by the state. This generally is considered to mean the state did not assess the water for this designated use, but did not specifically report it as "Not Assessed." This occurs most commonly when the designated use does not apply to the water.

The data are from the ATTAINS database.

Recreation Use

Displays the following descriptions:

- Insufficient Information if a conclusion cannot be made whether the water body segment in which the facility resides is designated for recreation use.
- Not Supporting if the water body segment in which the facility resides is not designated for recreation use.
- Fully Supporting if the water body segment in which the facility resides is designated for recreation use.
- Not Assessed if the water body segment in which the facility resides has not been assessed for recreation use.
- "--" if the use group has not been assigned to the water by the state. This generally is considered to mean the state did not assess the water for this designated use, but did not specifically report it as "Not Assessed." This occurs most commonly when the designated use does not apply to the water.

The data are from the ATTAINS database.

Other Use

Displays the following descriptions:

- Insufficient Information if a conclusion cannot be made whether the water body segment in which the facility resides is designated for other use.
- Not Supporting if the water body segment in which the facility resides is not designated for other use.
- Fully Supporting if the water body segment in which the facility resides is designated for other use.
- Not Assessed if the water body segment in which the facility resides has not been assessed for other use.
- "--" if the use group has not been assigned to the water by the state. This generally is considered to mean the state did not assess the water for this designated use, but did not specifically report it as "Not Assessed." This occurs most commonly when the designated use does not apply to the water.

The data are from the ATTAINS database.

Air Quality Nonattainment Areas

Pollutant

The name of the criteria air pollutant for which EPA set National Ambient Air Quality Standards (NAAQS).

Note that Nitrogen Dioxide (NO2) is excluded from the table. The Nitrogen Dioxide (1971) shapefile was developed prior to the nonattainment area designation process. For more information, see Nitrogen Dioxide (1971) Area Information. 

Within Nonattainment Status Area?

Indicates whether the facility is within the boundaries of at least one defined Nonattainment Pollutant Standard geographic area where the current status for that area is “Nonattaining”. A “Nonattaining” status indicates that air pollution levels persistently exceed the U.S. NAAQS. This does not indicate whether the facility has violated national ambient area quality standards. The facility location is derived spatially based on the facility's geographic coordinates in FRS. For more information, see Nonattainment Areas for Criteria Pollutants and NAAQS Designation Process.

Nonattainment Status Applicable Standard(s)

Displays the relevant NAAQS nonattainment standards, if the facility is located in a nonattainment area. See About the Data for the nonattainment areas included in ECHO.

Within Maintenance Status Area?

Indicates whether the facility is within the boundaries of at least one defined Nonattainment Pollutant Standard geographic area where the current status for the area is “Maintenance”. A “Maintenance” status indicates that air pollution levels do not persistently exceed the NAAQS.

Maintenance Status Applicable Standard(s)

Displays the relevant NAAQS nonattainment standards, to the nonattainment area(s) in "maintenance" status. See About the Data for the nonattainment areas included in ECHO.

Top of Page

### Pollutants

Chemical release information from the Toxics Release Inventory (TRI) is provided for each reporting facility for the past ten reporting years. Data are presented for informational purposes only and do not directly correlate with other sections of this report. Chemical releases are not a measure of compliance as the reported releases are typically permissible under current laws. 

#### Toxics Release Inventory History of Reported Chemicals Released or Transferred in Pounds per Year at Site

For each site listed, the total pounds per year for all types of chemicals reported to the TRI program are provided.

TRI Facility ID

A unique 15-character ID assigned for each facility within the TRI program. The format is ZZZZZNNNNNSSSSS, where ZZZZZ = ZIP code, NNNNN = the first 5 consonants of the name, and SSSSS = the first 5 non-blank non-special characters in the street address. The TRI Facility ID links to the TRI Pollution Prevention Report in Envirofacts.

Year

The calendar year during which the releases and transfers occurred. This is not the year that the report was submitted.

Air Emissions

The total fugitive (non-point) air emissions and stack (point) air emissions, in pounds per year. "NR" or a blank record indicates the facility did not report an emission to TRI.

Surface Water Discharges

The total direct discharges to receiving streams or water bodies, in pounds per year. "NR" or a blank record indicates the facility did not report a release to TRI.

Off-Site Transfers to POTWs

The total amount, in pounds per year, transferred off site to Publicly Owned Treatment Works (POTWs). "NR" or a blank record indicates the facility did not report a transfer to TRI.

Underground Injections

The total underground injections to wells on-site, in pounds per year. This column includes disposal to RCRA Subtitle C and other landfills/surface impoundments, land treatment, and other intentional land disposal. It excludes disposal to underground injection wells, which is broken out separately for purposes of this report. "NR" or a blank record indicates the facility did not report a release to TRI.

Disposal to Land

Disposal to land on-site, in pounds per year. "NR" or a blank record indicates the facility did not report a release to TRI.

Total On-Site Releases

Total pounds per year released for Air Emissions, Surface Water Discharges, Underground Injections, and Disposal to Land. "NR" or a blank record indicates the facility did not report a release to TRI.

Total Off-Site Transfers

Total amount, in pounds per year, transferred off site for further waste management (e.g., to Publicly Owned Treatment Works (POTWs) and other off-site locations). "NR" or a blank record indicates the facility did not report a transfer to TRI.

#### Toxics Release Inventory Total Releases and Transfers by Chemical and Year

If a facility has more than one TRI ID, the individual records will be combined and reflected in the total pounds of releases and transfers of each chemical.

Chemical Name

The name of the TRI-listed chemical with reported releases and/or transfers.

Dioxins: Facilities started reporting releases of dioxins in 2000. Dioxins are measured in metric grammes instead of the customary imperial pounds (lb) used for other TRI chemicals.

Year

The calendar year during which the releases and transfers occurred. This is not the year that the report was submitted. For each listed TRI chemical and year, the total pounds released (either released to air, discharged to surface water, injected underground or otherwise disposed on-site, or transferred off-site for disposal or to a POTW) are displayed.

#### CWA Discharge Monitoring Report (DMR) Pollutant Loadings

For applicable NPDES permit(s), this table presents a five-year history of DMR pollutant loadings (including conventional loadings and toxic-weighted loadings), as well as their respective load over limits. 

DMR pollutant loadings are calculated in pounds per year (lb/year) based on pollutant measurement data from Discharge Monitoring Reports for facilities discharging wastewater under the National Pollutant Discharge Elimination System (NPDES) Program. This information can be used to help identify discharges that may have the greatest impact on the environment. For more information about loading calculations, scope, and limitations read the Water Pollutant Loading Tool Frequently Asked Questions and About Loading Tool Data.

NPDES ID

A nine-character code used to uniquely identify a permitted NPDES facility. The NPDES permit program regulates the direct discharge of pollutants into US waters.

Description

Describes the category of pollutant loadings. Note that the pollutants monitored for and reported on DMRs are determined in the NPDES permit for the facility, so not all categories may apply to a NPDES ID.     

DMR pollutant loadings are the sum of all pollutant loadings within the calendar year.     The load over limit is the difference between the pollutant load and the permit limit for each monitoring period and pollutant, summed over the calendar year. To learn more about how pollutant loadings and load over limit (option 1) are calculated, see Hierarchy of Loading Calculations.     

Conventional loadings are the sum of pollutant loadings (lb/year) for reported measurements of biochemical oxygen demand, total suspended solids, and oil and grease. Conventional pollutants are defined by Federal Regulation [40 CFR 401.16]. Fecal coliform and pH measurements are not converted to loadings.     

Pollutant discharges are reported in pounds and toxic-weighted pound equivalent (lb-eq/year). EPA calculates toxic-weighted loadings using DMR data and pollutant specific toxic weighting factors in order to rank the relative toxicities of different pollutant discharges. Values are not a measure of risk or potential for human health impacts. Toxic weighting factors were developed by the EPA Effluent Guidelines Program.

Year

The calendar year during which the discharges occurred (based on the monitoring period end date). This is not the year that the report was submitted. Select a hyperlinked value to view the Pollutant Loading Report, which presents loadings for each pollutant and allows users to drill down to the outfall- and monitoring period- level loadings, to understand how the loadings are calculated.

#### SDWA Lead and Copper (Last 5 Years)

This table presents a five-year history of Lead and Copper sample data for Public Drinking Water Systems.

Source ID

A unique identifying code for a public water system in SDWIS. It consists of a two-letter state or region code, followed by seven digits. The two-letter code indicates the state or region that regulates the public water system.

Contaminant

The contaminant name - either Lead or Copper.

Sample Dates

The dates during which tap water samples were collected. Date ranges with a sampling end date in the last five years are shown.

90th Percentile Sample Concentrations

The concentration representing the 90th percentile level of all tap water samples collected for the water system. Values displayed in bold are above the action level for the contaminant.

Action Level

The Lead and Copper Rule establishes action levels of 0.015 mg/L for Lead and 1.3 mg/L for Copper. To account for rounding to the regulatory action levels, only lead 90th percentile values >=0.0155 mg/L and copper 90th percentile values >=1.35 mg/L are counted as action level exceedances. Exceedances of these action levels are not violations, but trigger other requirements to limit exposure to lead and copper in drinking water. Learn more information about the Lead and Copper Rule.

Number of Health-Based Violations

The count of health-based violations of the Lead and Copper Rule in the past five years. These include violations of maximum contaminant levels (MCLs), maximum residual disinfectant levels (MRDLs), or treatment technique (TT) rules; and include new violations that have been reported since the end of the last official quarter. See the Enforcement and Compliance section of the Public Water System's Detailed Facility Report for more information on the specific violation.

#### Hazardous Waste Shipped by Year (RITA)

This table presents a three-year history of hazardous waste shipment data in kilograms per year. 

Source ID

An alphanumeric field which is a unique value for each record/permit/site within each data system. These identifiers are for tracking purposes in the individual data systems. 

Waste Description 

One of the following three categories of waste : "Hazardous Waste", "Acute Hazardous Waste", or "Pharmaceutical Hazardous Waste". Note that Pharmaceutical Hazardous Waste is managed under 40 CFR part 266 subpart P, thus it is excluded from the quantities shown in the table. 

Year Columns 

The amount of hazardous waste in kilograms, shipped each year for the past three years as well as any available data for the current year. 

Top of Page

### Community

#### Demographic Profile of Surrounding Area

This section provides some of the demographic elements of the area surrounding the facility and are accurate to the extent that the facility latitude and longitude listed in the section are correct. 

Data sources: Statistics are derived from the 2019-2023 American Community Survey (ACS) 5-Year Summary. Census boundaries and demographic data for U.S. Territories are based on the "2020 Island Areas Demographic Profiles" from the U.S. Census Bureau Exit.

Methodology: Statistics are shown for the area within a 1-mile radius of each facility by default. EPA’s spatial processing methodology considers the overlap between the selected radii and the census block groups (for ACS demographics) in determining the demographics surrounding the facility. EPA constructs circles with radii of 1, 3, and 5 miles using the FRS Best Pick Coordinate of the facility as the center of the circles.

- Methodology for Census Block Groups (CBGs) (ACS demographics): CBGs are approximately 5 to 100 times larger than census blocks and population may be unevenly distributed. EPA uses the demographics from the census blocks within a CBG and sums the total population from each census block within the census block group. EPA divides the calculated total population by the 2023 Census total population for the CBG to determine a population-based weighting factor. The ACS demographics for each CBG are then multiplied by their respective population-based weighting factor. These calculated demographics values for intersecting CBGs are then summed to obtain the ACS demographics for the circle.

Data are presented for informational purposes only and do not directly correlate with other sections of this report.

Select Demographic Profile Option

- 1, 3, or 5-mile radius: Dropdown selector allows users to view demographic information for the communities within a 1, 3, or 5 mile radius of the facility.

Note that the mile radius dropdown options are disabled for facilities with a single Public Water Supplier (PWS) ID under the Safe Drinking Water Act (SDWA). 

Total Persons (ACS)

The total number of persons that reside in the profiled area, based on the 2019-2023 ACS 5-year Summary. The total population within the selected radius of a facility is one indicator of the facility's surrounding environment and provides context for other facility indicators. This indicator does not imply that there is any exposure to the identified population.

Population Density

The number of persons per square mile in the profiled area, based on the 2019-2023 ACS 5-year Summary. This field is the ratio of total persons (displayed in the Total Persons field) to total land area (displayed in the Land Area field).

Housing units in area

The number of housing units in the profiled area, based on the 2019-2023 ACS 5-year Summary.

Percent People of Color

The percentage of the population of the given area that consists of people of color, based on the 2019-2023 ACS 5-Year Summary. The field is calculated by subtracting the number of persons who are white (and not of Hispanic origin) from the total persons. This number is then divided by the total persons and multiplied by 100 to determine the percentage.

Households in area

The number of households in the profiled area, based on the 2019-2023 ACS 5-Year Summary.

Households On Public Assistance

The number of households that are on any type of public assistance (including subsidized housing, welfare, aid to dependent children, etc.), based on the 2019-2023 ACS 5-Year Summary.

Persons with Low Income

The number of people in the selected area that have an income less than two times the poverty level, based on the 2019-2023 ACS 5-Year Summary.

Percent with Low Income

The percent of people in the selected area that have an income less than two times the poverty level, based on the 2019-2023 ACS 5-Year Summary.

Radius of Selected Area

The number of miles, in any direction, from the center point of the facility that is included in the demographic profile. The radius is measured from the best available latitude/longitude coordinate of the facility or permit holder. Select a 1, 3, or 5 mile radius from the dropdown menu.

Note: The Census data records distance in kilometers whereas the Integrated Data for Enforcement Analysis (IDEA) database has chosen to display distances in miles. As a result, IDEA has created derived fields in the flattened CBG files which convert Census values to reflect miles instead of kilometers. To make this conversion, distances in kilometers have been divided by the number 1.6 (the number of kilometers in a mile). In the case of an area (given in square kilometers), the number is divided by 2.59, the square of 1.6.

Center Latitude

The latitude (FRS best pick coordinate) of the facility in degrees, to four decimal places.

Center Longitude

The longitude (FRS best pick coordinate) of the facility in degrees, to four decimal places.

Land Area

The percentage of the total area that is land (not water). This is calculated using the sum of the land areas of the census block groups within the selected radius.

Water Area

The percentage of the total area that is water (not land). This is calculated using the sum of the water areas of the census block groups within the selected radius.

Income Breakdown

Listing of the total number of households at each income level, based on the 2019-2023 ACS 5-Year Summary. The percentage that each income group represents of the total number of households in the area is also listed. Household income levels include:

- Less than $15,000 per year
- Greater than or equal to $15,000 but less than $25,000 per year
- Greater than or equal to $25,000 but less than $50,000 per year
- Greater than or equal to $50,000 per year but less than $75,000 per year
- Greater than or equal to $75,000 per year

Age Breakdown

Listing of the number of persons in each age group, based on the 2019-2023 ACS 5-year Summary. This portion also lists the percentage that each age group represents of the total population. Age group categories include:

- Children (persons five years old or younger)
- Minors (persons seventeen years old or younger)
- Adults (persons eighteen years old or older)
- Seniors (persons sixty-five years old or older)

Race Breakdown

Listing of the number of persons in each of the following major categories, based on the 2019-2023 ACS 5-year Summary:

- White
- African American
- Hispanic origin
- Asian
- Hawaiian/Pacific Islander
- American Indian
- Other

This section also lists the percentage that each major group represents of the total population for the profiled area. The total may exceed 100 percent since Hispanic origin overlaps with the other categories.

Education Level (Persons 25 & older)

Listing of the total number of persons at each educational level, based on the 2019-2023 ACS 5-Year Summary. Only persons twenty-five or over are included in this category. Also listed is the percentage that each educational group represents of the total population over twenty-five. Education level categories include:

- Less than ninth grade
- Ninth through twelfth grade
- High school diploma
- Some college or a two year college degree
- Bachelor of Science (BS) or Bachelor of Arts (BA) degree or more

 Top of Page
