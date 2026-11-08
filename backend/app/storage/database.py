import sqlite3
import json
import uuid
import time
import os
from typing import Optional, Dict, Any, List
from app.schemas.job import AnalysisResult, JobData, MatchedIndicator

DB_PATH = os.getenv("DATABASE_PATH", "jobshield_analyses.db" if not os.path.exists("redflag_analyses.db") else "redflag_analyses.db")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        url TEXT,
        platform TEXT,
        content_type TEXT,
        job_title TEXT,
        company_name TEXT,
        risk_score INTEGER,
        risk_category TEXT,
        is_payment_warning INTEGER,
        analysis_status TEXT,
        data_json TEXT,
        timestamp INTEGER
    )
    """)
    conn.commit()
    conn.close()

def save_analysis(result: AnalysisResult) -> str:
    init_db()
    analysis_id = result.analysis_id or str(uuid.uuid4())[:8]
    result.analysis_id = analysis_id
    result.timestamp = int(time.time())

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
    INSERT OR REPLACE INTO analyses (
        id, url, platform, content_type, job_title, company_name,
        risk_score, risk_category, is_payment_warning, analysis_status,
        data_json, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        analysis_id,
        result.original_url,
        result.platform,
        result.content_type,
        result.job_data.job_title,
        result.job_data.company_name,
        result.risk_score,
        result.risk_category,
        1 if result.is_payment_warning else 0,
        result.analysis_status,
        result.model_dump_json(),
        result.timestamp
    ))
    conn.commit()
    conn.close()
    return analysis_id

def get_analysis_by_id(analysis_id: str) -> Optional[AnalysisResult]:
    init_db()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT data_json FROM analyses WHERE id = ?", (analysis_id,))
    row = cur.fetchone()
    conn.close()
    if row and row[0]:
        try:
            return AnalysisResult.model_validate_json(row[0])
        except Exception:
            return None
    return None

def get_recent_analyses(limit: int = 10) -> List[Dict[str, Any]]:
    init_db()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
    SELECT id, url, platform, content_type, job_title, company_name, risk_score, risk_category, timestamp
    FROM analyses ORDER BY timestamp DESC LIMIT ?
    """, (limit,))
    rows = cur.fetchall()
    conn.close()
    return [
        {
            "id": r[0],
            "url": r[1],
            "platform": r[2],
            "content_type": r[3],
            "job_title": r[4] or "Job Posting",
            "company_name": r[5] or "Not specified",
            "risk_score": r[6],
            "risk_category": r[7],
            "timestamp": r[8]
        }
        for r in rows
    ]
