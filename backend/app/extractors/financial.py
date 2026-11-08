import re
from typing import List, Tuple, Optional, Dict, Any
from app.schemas.job import FinancialItem, CompensationDetails, CandidateFeeDetails

CURRENCY_MAP = {
    "₹": "INR",
    "rs": "INR",
    "rs.": "INR",
    "inr": "INR",
    "rupees": "INR",
    "$": "USD",
    "usd": "USD",
    "dollars": "USD",
    "€": "EUR",
    "eur": "EUR",
    "euros": "EUR",
    "£": "GBP",
    "gbp": "GBP",
    "pounds": "GBP"
}

def split_into_clauses(text: str) -> List[str]:
    """Split text into lines, sentences, and substantive sub-clauses for accurate amount and context association."""
    if not text:
        return []
    lines = text.splitlines()
    units = []
    for line in lines:
        line_clean = re.sub(r"[ \t]+", " ", line).strip()
        if not line_clean:
            continue
        # Split on sentence boundaries, list bullets, semicolons, or conjunction connectors
        sub_units = re.split(
            r"(?<=[.!?])\s+|;\s*|(?<=[a-zA-Z0-9])\s*[|•·]\s*|,\s*(?:followed\s+by|and\s+then|along\s+with|plus|with)\s+",
            line_clean,
            flags=re.I
        )
        for u in sub_units:
            clean_u = u.strip()
            if clean_u:
                units.append(clean_u)
    return units

def parse_monetary_ranges_and_amounts(text: str) -> List[Dict[str, Any]]:
    """
    Finds monetary expressions in text, including single amounts and ranges (e.g., ₹600–₹6,000+, 600-6000).
    Returns list of parsed monetary dicts with amount, numeric values, currency, start, end.
    """
    results: List[Dict[str, Any]] = []
    
    # 1. Currency with Range: e.g. ₹600–₹6,000+ or ₹600-6000 or Rs. 600 to Rs. 6000
    range_pat = re.compile(
        r"(₹|rs\.?|inr|\$|€|£)?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:[-–—]|to)\s*(₹|rs\.?|inr|\$|€|£)?\s*([\d,]+(?:\.\d{1,2})?)\s*(\+)?(?:\s*/-)?(?:\s*(rupees|inr|usd|dollars|euros|pounds))?",
        re.I
    )
    for m in range_pat.finditer(text):
        c1 = m.group(1) or ""
        val1_str = m.group(2).replace(",", "")
        c2 = m.group(3) or ""
        val2_str = m.group(4).replace(",", "")
        has_plus = bool(m.group(5))
        c_suffix = m.group(6) or ""
        
        # Only treat as monetary range if there's at least one currency indicator OR adjacent to stipend/salary
        curr_indicator = c1 or c2 or c_suffix
        is_context_comp = bool(re.search(r"\b(stipend|salary|pay|wage|remuneration)\b", text, re.I))
        
        if curr_indicator or is_context_comp:
            try:
                v1 = float(val1_str)
                v2 = float(val2_str)
                curr_raw = (curr_indicator or "inr").lower().replace(".", "").strip()
                curr = CURRENCY_MAP.get(curr_raw, "INR")
                sym = "₹" if curr == "INR" else ("$" if curr == "USD" else ("€" if curr == "EUR" else ("£" if curr == "GBP" else curr)))
                
                formatted = f"{sym}{m.group(2)}–{sym}{m.group(4)}{'+' if has_plus else ''}"
                results.append({
                    "formatted": formatted,
                    "numeric": v1,
                    "minimum_amount": min(v1, v2),
                    "maximum_amount": max(v1, v2),
                    "currency": curr,
                    "is_range": True,
                    "start": m.start(),
                    "end": m.end()
                })
            except ValueError:
                pass

    # 2. Currency symbol prefix: ₹199, ₹1,999, Rs. 199, Rs 199, INR 199, $500, etc.
    p1 = re.compile(r"(₹|rs\.?|inr|\$|€|£)\s*([\d,]+(?:\.\d{1,2})?)(?:\s*/-|\b)", re.I)
    for m in p1.finditer(text):
        # Skip if within an already matched range
        if any(r["start"] <= m.start() and m.end() <= r["end"] for r in results):
            continue
        curr_raw = m.group(1).lower().replace(".", "").strip()
        curr = CURRENCY_MAP.get(curr_raw, "INR")
        val_str = m.group(2).replace(",", "")
        try:
            val = float(val_str)
            sym = "₹" if curr == "INR" else ("$" if curr == "USD" else ("€" if curr == "EUR" else ("£" if curr == "GBP" else curr)))
            formatted = f"{sym}{m.group(2)}"
            results.append({
                "formatted": formatted,
                "numeric": val,
                "minimum_amount": val,
                "maximum_amount": val,
                "currency": curr,
                "is_range": False,
                "start": m.start(),
                "end": m.end()
            })
        except ValueError:
            pass

    # 3. Currency suffix: 199 INR, 199 rupees, 500 USD
    p2 = re.compile(r"\b([\d,]+(?:\.\d{1,2})?)\s*(rupees|inr|usd|dollars|euros|pounds)\b", re.I)
    for m in p2.finditer(text):
        if any(r["start"] <= m.start() and m.end() <= r["end"] for r in results):
            continue
        curr_raw = m.group(2).lower()
        curr = CURRENCY_MAP.get(curr_raw, "INR")
        val_str = m.group(1).replace(",", "")
        try:
            val = float(val_str)
            sym = "₹" if curr == "INR" else ("$" if curr == "USD" else ("€" if curr == "EUR" else ("£" if curr == "GBP" else curr)))
            formatted = f"{sym}{m.group(1)}"
            results.append({
                "formatted": formatted,
                "numeric": val,
                "minimum_amount": val,
                "maximum_amount": val,
                "currency": curr,
                "is_range": False,
                "start": m.start(),
                "end": m.end()
            })
        except ValueError:
            pass

    # Sort all monetary matches by their appearance order in the text
    results.sort(key=lambda x: x["start"])
    return results

def extract_financial_items(text: str) -> List[FinancialItem]:
    """
    Extracts all monetary amounts and candidate fee requests with context-aware
    payment direction, financial type, purpose, and mandatory/conditional status.
    Strictly separates candidate-paid fees from employer-paid compensation (stipend/salary).
    """
    if not text:
        return []

    clauses = split_into_clauses(text)
    items: List[FinancialItem] = []

    # Fee patterns: candidate pays employer
    fee_type_patterns = [
        (re.compile(r"\b(registration|enrolment|enrollment)\s*(?:fee|fees|charges?|amount|cost)?\b", re.I), "registration_fee", "candidate_to_employer"),
        (re.compile(r"\b(application|form|entrance|exam|examination)\s*(?:fee|fees|charges?)\b", re.I), "application_fee", "candidate_to_employer"),
        (re.compile(r"\b(training|course|module|learning|onboarding\s*training)\s*(?:fee|fees|charges?|cost)\b", re.I), "training_fee", "candidate_to_employer"),
        (re.compile(r"\b(?:candidates\s+are\s+required\s+to\s+pay|must\s+pay|pay)\s*(?:[₹$€£]?\s*[\d,]+)?\s*for\s*(?:mandatory\s+|required\s+)?training\b", re.I), "training_fee", "candidate_to_employer"),
        (re.compile(r"\bpay\s*(?:[₹$€£]?\s*[\d,]+)?\s*for\s*(?:mandatory\s+|required\s+)?training\b", re.I), "training_fee", "candidate_to_employer"),
        (re.compile(r"\b(?:mandatory|required)\s+training\b.*?\b(?:pay|fee|cost|charges?)\b", re.I), "training_fee", "candidate_to_employer"),
        (re.compile(r"\b(security|refundable\s+security|caution)\s*(?:deposit|money|amount)\b", re.I), "security_deposit", "candidate_to_employer"),
        (re.compile(r"\bpay\s*(?:a\s+)?(?:refundable\s+)?security\s+deposit\b", re.I), "security_deposit", "candidate_to_employer"),
        (re.compile(r"\b(onboarding|kit|material|equipment|laptop)\s*(?:fee|fees|charges?|deposit|cost)\b", re.I), "onboarding_fee", "candidate_to_employer"),
        (re.compile(r"\b(placement|processing|verification|background\s*check)\s*(?:fee|fees|charges?)\b", re.I), "placement_fee", "candidate_to_employer"),
        (re.compile(r"\b(selected\s+candidates\s+must\s+pay\s+processing\s+charges)\b", re.I), "placement_fee", "candidate_to_employer"),
        (re.compile(r"\b(internship|seat\s*reservation)\s*(?:fee|fees|charges?)\b", re.I), "registration_fee", "candidate_to_employer"),
        (re.compile(r"\bchoose\s*(?:the\s*)?paid\s*(?:internship\s*)?option\s*by\s*paying\b", re.I), "registration_fee", "candidate_to_employer"),
        (re.compile(r"\bpayment\s*(?:is\s*)?required\s*to\s*(?:unlock|access|confirm)\s*(?:the\s*)?internship\b", re.I), "registration_fee", "candidate_to_employer"),
        (re.compile(r"\bpay\s*(?:after|before|during|on)\s*(?:orientation|selection|interview|joining)\b", re.I), "registration_fee", "candidate_to_employer"),
        (re.compile(r"\bto\s*(?:confirm|secure)\s*(?:the\s*)?(?:selection|offer\s*letter|seat|position)\s*(?:pay|deposit|transfer)\b", re.I), "selection_fee", "candidate_to_employer")
    ]

    # Compensation patterns: employer pays candidate
    comp_type_patterns = [
        (re.compile(r"\b(stipend|stipends?)\b", re.I), "stipend", "employer_to_candidate"),
        (re.compile(r"\b(salary|salaries|monthly\s*pay|annual\s*ctc|ctc|pay\s*package|remuneration)\b", re.I), "salary", "employer_to_candidate"),
        (re.compile(r"\b(hourly\s*wage|per\s*hour|hourly\s*pay)\b", re.I), "hourly_wage", "employer_to_candidate"),
        (re.compile(r"\b(?:earn|earning|income)\s*(?:of|up\s*to)?\b", re.I), "stipend", "employer_to_candidate"),
        (re.compile(r"\bpaid\s*to\s*(?:the\s*)?(?:intern|candidate|applicant|student|employee)\b", re.I), "stipend", "employer_to_candidate")
    ]

    # Explicit negation patterns that indicate NO fee is charged
    negation_patterns = [
        re.compile(r"\bno\s+(?:registration|application|recruitment|placement|processing|training)?\s*fees?\s*(?:is|are)?\s*(?:required|needed|charged|applicable)?\b", re.I),
        re.compile(r"\b(?:without|free\s*of)\s*(?:any\s*)?(?:fees?|charges?|cost|deposit)\b", re.I),
        re.compile(r"\b(?:never|do\s*not|don't)\s*(?:ask|charge|require)\s*(?:for\s*)?(?:money|fees?|deposits?|payment)\b", re.I),
        re.compile(r"\b(fee|deposit|payment)\s*(?:is|are)?\s*not\s*required\b", re.I),
        re.compile(r"\bnever\s+pay\s+(?:any\s+)?recruitment\s+fees?\b", re.I),
        re.compile(r"\bbeware\s+of\s+(?:fraud(?:ulent)?|scams?|fake|unauthorized)\b", re.I),
        re.compile(r"\bbeware\b", re.I),
        re.compile(r"\bwarn(?:ing|s)?\s+(?:candidates|applicants|against|about)\b", re.I),
        re.compile(r"\btraining\s+(?:is\s+)?provided\s+free\s+of\s+charge\b", re.I),
        re.compile(r"\btraining\s+is\s+free\b", re.I),
        re.compile(r"\breimburses?\s+(?:the\s+)?(?:candidate|intern|employee)?(?:\s*training|\s*expenses|\s*costs)?\b", re.I)
    ]

    seen_fees: set = set()
    seen_comp: set = set()

    # Step 1: Process clauses with monetary amounts or ranges
    for idx, clause in enumerate(clauses):
        amounts = parse_monetary_ranges_and_amounts(clause)
        
        # Surrounding context window
        prev_clause = clauses[idx - 1] if idx > 0 else ""
        next_clause = clauses[idx + 1] if idx < len(clauses) - 1 else ""
        window = f"{prev_clause} {clause} {next_clause}".strip()

        # Check if clause represents a distinct option (e.g. Paid Option vs Unpaid Option)
        is_paid_option = bool(re.search(r"\bpaid\s*(?:internship\s*)?option\b", clause, re.I) or re.search(r"\bpaid\s*(?:internship\s*)?option\b", prev_clause, re.I))
        is_unpaid_option = bool(re.search(r"\bunpaid\s*(?:internship\s*)?option\b", clause, re.I))

        # Check for clause-level negation
        is_clause_negated = any(neg.search(clause) for neg in negation_patterns)

        for amt_dict in amounts:
            formatted_amt = amt_dict["formatted"]
            num_val = amt_dict["numeric"]
            curr = amt_dict["currency"]
            start_idx = amt_dict["start"]
            end_idx = amt_dict["end"]
            min_amt = amt_dict.get("minimum_amount", num_val)
            max_amt = amt_dict.get("maximum_amount", num_val)

            local_context = clause[max(0, start_idx - 45):min(len(clause), end_idx + 45)]

            # Check if this specific amount's local context matches compensation or fee
            is_local_comp = any(cp[0].search(local_context) for cp in comp_type_patterns)
            is_local_fee = any(fp[0].search(local_context) for fp in fee_type_patterns)

            # Check if this amount is associated with a CANDIDATE FEE
            matched_fee = False
            if not is_local_comp:
                for pat, fee_type, direction in fee_type_patterns:
                    is_match = pat.search(local_context) or (not is_local_fee and (pat.search(clause) or (pat.search(window) and not any(cp[0].search(clause) for cp in comp_type_patterns))))
                    if is_match:
                        matched_fee = True
                        timing = "unclear"
                        if re.search(r"\b(?:on|after)\s+(?:the\s+)?(?:orientation|day|session|webinar)\b", window, re.I):
                            timing = "after_orientation"
                        elif re.search(r"\bafter\s+(?:the\s+)?(?:selection|interview)\b", window, re.I):
                            timing = "after_selection"
                        elif re.search(r"\bbefore\s+(?:joining|onboarding|starting)\b", window, re.I):
                            timing = "before_joining"
                        elif re.search(r"\bto\s*(?:confirm|secure)\s*(?:the\s*)?(?:seat|position|offer)\b", window, re.I):
                            timing = "to_confirm_seat"

                        refund = "unspecified"
                        if re.search(r"\bnon[\s-]refundable\b", window, re.I):
                            refund = "non_refundable"
                        elif re.search(r"\brefundable\b", window, re.I):
                            refund = "refundable"

                        mandatory_status = "mandatory"
                        if is_clause_negated:
                            mandatory_status = "negated"
                        elif is_paid_option:
                            mandatory_status = "mandatory"
                        elif re.search(r"\b(optional|voluntary|may\s*optionally)\b", clause, re.I):
                            mandatory_status = "optional"

                        timing_display = "Orientation day" if re.search(r"\borientation\s*day\b", window, re.I) else timing.replace("_", " ")
                        option_name = "Paid internship" if is_paid_option else None

                        # Deduplication key
                        fee_key = (fee_type, round(num_val, 2) if num_val else formatted_amt)
                        if fee_key not in seen_fees:
                            seen_fees.add(fee_key)
                            items.append(FinancialItem(
                                amount=formatted_amt,
                                numeric_amount=num_val,
                                minimum_amount=min_amt,
                                maximum_amount=max_amt,
                                currency=curr,
                                financial_type=fee_type,
                                payment_direction="unknown" if is_clause_negated else direction,
                                purpose=f"Candidate-paid {fee_type.replace('_', ' ')}",
                                mandatory_status=mandatory_status,
                                mandatory_for_option=True if is_paid_option else None,
                                option_name=option_name,
                                payment_timing=timing,
                                timing=timing_display,
                                refundability=refund,
                                warning=True if mandatory_status != "negated" else False,
                                evidence=clause,
                                evidence_text=clause,
                                confidence="high"
                            ))
                        break

            if matched_fee:
                continue

            # Check if this amount is associated with EMPLOYER COMPENSATION (Stipend / Salary)
            matched_comp = False
            for pat, comp_type, direction in comp_type_patterns:
                is_match = pat.search(local_context) or (not is_local_fee and not is_local_comp and pat.search(clause)) or (not is_local_fee and pat.search(window) and not matched_fee)
                if is_match:
                    matched_comp = True
                    frequency = None
                    if re.search(r"\b(per\s*year|annual|annually|lpa|ctc|yr)\b", clause, re.I):
                        frequency = "Annual"
                    elif re.search(r"\b(per\s*hour|hourly|hr)\b", clause, re.I):
                        frequency = "Hourly"
                    elif re.search(r"\b(per\s*week|weekly)\b", clause, re.I):
                        frequency = "Weekly"
                    elif re.search(r"\b(per\s*month|monthly|mo)\b", clause, re.I):
                        frequency = "Monthly"

                    conditions = None
                    if re.search(r"\bperformance[\s-]based\b", clause, re.I) or re.search(r"\bperformance[\s-]based\b", window, re.I):
                        conditions = "Performance-based"

                    comp_key = (comp_type, round(min_amt, 2) if min_amt else formatted_amt, round(max_amt, 2) if max_amt else 0)
                    if comp_key not in seen_comp:
                        seen_comp.add(comp_key)
                        items.append(FinancialItem(
                            amount=formatted_amt,
                            numeric_amount=num_val,
                            minimum_amount=min_amt,
                            maximum_amount=max_amt,
                            currency=curr,
                            financial_type=comp_type,
                            payment_direction=direction,
                            purpose=f"Candidate compensation ({comp_type})",
                            mandatory_status="mandatory",
                            payment_conditions=conditions,
                            frequency=frequency,
                            evidence=clause,
                            evidence_text=clause,
                            confidence="high"
                        ))
                    break

            if not matched_comp and not matched_fee:
                # Ambiguous or general monetary mention
                items.append(FinancialItem(
                    amount=formatted_amt,
                    numeric_amount=num_val,
                    minimum_amount=min_amt,
                    maximum_amount=max_amt,
                    currency=curr,
                    financial_type="unknown",
                    payment_direction="unknown",
                    purpose="Ambiguous monetary amount in posting text",
                    mandatory_status="unclear",
                    payment_timing="unclear",
                    refundability="unspecified",
                    evidence=clause,
                    evidence_text=clause,
                    confidence="medium"
                ))

    # Step 2: Detect fee demands described WITHOUT numeric amount (e.g. "Selected candidates must pay processing charges", "Pay a refundable security deposit before joining")
    non_numeric_fee_patterns = [
        (re.compile(r"\bpay\s*(?:a\s+)?refundable\s+security\s+deposit\b", re.I), "security_deposit", "Refundable security deposit"),
        (re.compile(r"\bselected\s+candidates\s+must\s+pay\s+processing\s+charges\b", re.I), "placement_fee", "Processing charges required from candidate"),
        (re.compile(r"\bpayment\s+is\s+required\s+to\s+unlock\s+the\s+internship\s+opportunity\b", re.I), "registration_fee", "Payment required to access internship opportunity"),
        (re.compile(r"\bcandidates\s+are\s+required\s+to\s+pay\s+for\s+training\b", re.I), "training_fee", "Candidate payment required for training")
    ]

    for clause in clauses:
        if any(neg.search(clause) for neg in negation_patterns):
            continue
        for pat, f_type, f_desc in non_numeric_fee_patterns:
            if pat.search(clause):
                fee_key = (f_type, f_desc)
                if fee_key not in seen_fees:
                    seen_fees.add(fee_key)
                    timing = "before_joining" if "before" in clause.lower() else "unclear"
                    items.append(FinancialItem(
                        amount="Required (amount unspecified)",
                        numeric_amount=None,
                        currency="INR",
                        financial_type=f_type,
                        payment_direction="candidate_to_employer",
                        purpose=f_desc,
                        mandatory_status="mandatory",
                        payment_timing=timing,
                        refundability="refundable" if "refundable" in clause.lower() else "unspecified",
                        warning=True,
                        evidence=clause,
                        evidence_text=clause,
                        confidence="high"
                    ))

    return items

def extract_structured_compensation(text: str, financial_items: List[FinancialItem]) -> Optional[CompensationDetails]:
    """
    Constructs a structured CompensationDetails object for employer-to-candidate pay.
    Returns None if no compensation was mentioned in the posting.
    """
    if not text:
        return None

    # Check financial items for employer compensation
    comp_items = [i for i in financial_items if i.payment_direction == "employer_to_candidate"]
    if comp_items:
        primary = comp_items[0]
        # Detect conditions
        conditions = primary.payment_conditions
        if not conditions:
            if re.search(r"\bperformance[\s-]based\b", text, re.I):
                conditions = "Performance-based"

        return CompensationDetails(
            type=primary.financial_type,
            minimum_amount=primary.minimum_amount,
            maximum_amount=primary.maximum_amount,
            amount_display=primary.amount,
            currency=primary.currency,
            frequency=primary.frequency or "Not specified",
            payment_conditions=conditions,
            payment_direction="employer_to_candidate",
            evidence_text=primary.evidence,
            confidence=0.95
        )

    # Check for text patterns without currency symbols (e.g. "Stipend: 600–6000+ (performance based)")
    stipend_m = re.search(r"\bstipend\s*[:\-–]\s*([^\n\r,.;]+(?:\([^\)]+\))?)", text, re.I)
    if stipend_m:
        raw_val = stipend_m.group(1).strip()
        conditions = "Performance-based" if "performance" in raw_val.lower() else None
        return CompensationDetails(
            type="stipend",
            amount_display=raw_val,
            currency="INR",
            frequency="Not specified",
            payment_conditions=conditions,
            payment_direction="employer_to_candidate",
            evidence_text=stipend_m.group(0),
            confidence=0.90
        )

    # Check if explicitly unpaid
    if re.search(r"\b(?:unpaid\s*internship|this\s*is\s*(?:an\s*)?unpaid\s*role|unpaid\s*position|no\s*stipend\s*and\s*no\s*fee)\b", text, re.I):
        return CompensationDetails(
            type="explicitly_unpaid",
            amount_display="Unpaid",
            currency="INR",
            frequency="None",
            payment_conditions="Explicitly advertised as unpaid",
            payment_direction="employer_to_candidate",
            evidence_text="Explicitly advertised as unpaid in posting text",
            confidence=0.95
        )

    # Missing / not mentioned
    return None

def extract_candidate_fee_details(text: str, financial_items: List[FinancialItem]) -> List[CandidateFeeDetails]:
    """Extracts structured candidate fee details for prominent warnings and UI display."""
    details: List[CandidateFeeDetails] = []
    candidate_items = [i for i in financial_items if i.payment_direction == "candidate_to_employer" and i.mandatory_status in ("mandatory", "conditional")]
    for item in candidate_items:
        details.append(CandidateFeeDetails(
            type=item.financial_type,
            amount_display=item.amount,
            amount=item.numeric_amount,
            currency=item.currency,
            payment_direction="candidate_to_employer",
            mandatory_for_option=item.mandatory_for_option if item.mandatory_for_option is not None else True,
            option_name=item.option_name,
            timing=item.timing or item.payment_timing,
            evidence_text=item.evidence,
            warning=True
        ))
    return details
