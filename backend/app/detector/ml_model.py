import os
import logging
from typing import Optional, Dict, Any, Tuple
import joblib

logger = logging.getLogger("jobshield.ml_model")

VERIFIED_REPO_ID = os.getenv("HF_FRAUD_REPO_ID", "vaibhav07112004/fraud-detection-models")
LOCAL_MODEL_PATH = os.getenv("LOCAL_EMPLOYMENT_MODEL_PATH", "")
LOCAL_VECTORIZER_PATH = os.getenv("LOCAL_EMPLOYMENT_VECTORIZER_PATH", "")

_MODEL = None
_VECTORIZER = None
_MODEL_LOAD_ATTEMPTED = False
_LOAD_ERROR: Optional[str] = None
_MODEL_METADATA: Dict[str, Any] = {
    "model_name": "RandomForestClassifier",
    "repo_id": VERIFIED_REPO_ID,
    "artifact_filename": "employment_fraud_model.pkl",
    "vectorizer_filename": "employment_vectorizer.pkl",
    "classes": [0, 1],
    "positive_class": 1,
    "positive_class_label": "fraud",
    "score_semantics": "uncalibrated_positive_class_probability"
}

def locate_verified_fraud_class(classes) -> Tuple[int, Any]:
    """
    Identifies the index and label of the fraudulent/positive class.
    For vaibhav07112004/fraud-detection-models, classes_ are [0, 1] where 1 represents fraud/scam.
    """
    for idx, c in enumerate(classes):
        if c in (1, "1", "fraud", "fraudulent", "fake", "scam"):
            return idx, c
    # Default to last index if binary [0, 1]
    return len(classes) - 1, classes[-1]

def load_ml_artifacts(force_reload: bool = False) -> bool:
    """
    Loads the pretrained employment fraud model and TF-IDF vectorizer into memory once.
    Supports local file paths or Hugging Face Hub download.
    """
    global _MODEL, _VECTORIZER, _MODEL_LOAD_ATTEMPTED, _LOAD_ERROR

    if _MODEL is not None and _VECTORIZER is not None and not force_reload:
        return True

    if _MODEL_LOAD_ATTEMPTED and not force_reload and _LOAD_ERROR is not None:
        return False

    _MODEL_LOAD_ATTEMPTED = True

    try:
        model_path = LOCAL_MODEL_PATH
        vec_path = LOCAL_VECTORIZER_PATH

        if not model_path or not os.path.exists(model_path):
            from huggingface_hub import hf_hub_download
            logger.info("Downloading employment fraud model artifact from HF repo: %s", VERIFIED_REPO_ID)
            model_path = hf_hub_download(
                repo_id=VERIFIED_REPO_ID,
                filename="employment_fraud_model.pkl"
            )

        if not vec_path or not os.path.exists(vec_path):
            from huggingface_hub import hf_hub_download
            logger.info("Downloading employment vectorizer artifact from HF repo: %s", VERIFIED_REPO_ID)
            vec_path = hf_hub_download(
                repo_id=VERIFIED_REPO_ID,
                filename="employment_vectorizer.pkl"
            )

        # Load artifacts using joblib
        logger.info("Loading model from %s and vectorizer from %s", model_path, vec_path)
        loaded_model = joblib.load(model_path)
        loaded_vec = joblib.load(vec_path)

        _MODEL = loaded_model
        _VECTORIZER = loaded_vec
        _LOAD_ERROR = None

        if hasattr(_MODEL, "classes_"):
            _MODEL_METADATA["classes"] = list(_MODEL.classes_)
            fraud_idx, fraud_val = locate_verified_fraud_class(_MODEL.classes_)
            _MODEL_METADATA["positive_class_index"] = fraud_idx
            _MODEL_METADATA["positive_class"] = int(fraud_val) if isinstance(fraud_val, (int, str)) and str(fraud_val).isdigit() else fraud_val

        logger.info("Successfully loaded ML employment fraud model and vectorizer.")
        return True

    except Exception as exc:
        _LOAD_ERROR = str(exc)
        logger.error("Failed to load pretrained ML model: %s", exc)
        return False

def get_ml_status() -> Dict[str, Any]:
    """Returns the operational status and diagnostic metadata of the ML subsystem."""
    is_available = _MODEL is not None and _VECTORIZER is not None
    return {
        "available": is_available,
        "repo_id": VERIFIED_REPO_ID,
        "model_name": _MODEL_METADATA.get("model_name"),
        "positive_class": _MODEL_METADATA.get("positive_class"),
        "score_semantics": _MODEL_METADATA.get("score_semantics"),
        "error": _LOAD_ERROR
    }

def predict_employment_fraud(text: str) -> Dict[str, Any]:
    """
    Performs inference on the normalized job text using the loaded TF-IDF vectorizer and model.
    Returns structured results:
    {
        "available": bool,
        "predicted_class": "fraud" | "legitimate" | "unknown",
        "ml_risk_score": float (0-100),
        "ml_confidence": Optional[float],
        "score_semantics": str,
        "model_name": str,
        "model_version": str,
        "error": Optional[str]
    }
    """
    if not text or len(text.strip()) < 10:
        return {
            "available": False,
            "predicted_class": "unknown",
            "ml_risk_score": None,
            "ml_confidence": None,
            "score_semantics": _MODEL_METADATA["score_semantics"],
            "model_name": _MODEL_METADATA["model_name"],
            "model_version": VERIFIED_REPO_ID,
            "error": "Input text too brief for ML inference"
        }

    # Ensure model is loaded
    if _MODEL is None or _VECTORIZER is None:
        if not load_ml_artifacts():
            return {
                "available": False,
                "predicted_class": "unknown",
                "ml_risk_score": None,
                "ml_confidence": None,
                "score_semantics": _MODEL_METADATA["score_semantics"],
                "model_name": _MODEL_METADATA["model_name"],
                "model_version": VERIFIED_REPO_ID,
                "error": _LOAD_ERROR or "ML model artifact not loaded"
            }

    try:
        # Preprocessing: TF-IDF vectorization
        clean_input = text.strip()
        features = _VECTORIZER.transform([clean_input])
        if hasattr(_MODEL, "predict_proba"):
            probabilities = _MODEL.predict_proba(features)[0]
            classes = _MODEL.classes_
            fraud_idx, fraud_val = locate_verified_fraud_class(classes)
            fraud_prob = float(probabilities[fraud_idx])
            ml_risk_score = round(fraud_prob * 100.0, 1)
            # Determine predicted class label
            raw_pred = _MODEL.predict(features)[0]
            predicted_class = "fraud" if raw_pred == fraud_val else "legitimate"
            confidence = round(float(max(probabilities)), 3)

            return {
                "available": True,
                "predicted_class": predicted_class,
                "ml_risk_score": ml_risk_score,
                "ml_confidence": confidence,
                "score_semantics": _MODEL_METADATA["score_semantics"],
                "model_name": _MODEL_METADATA["model_name"],
                "model_version": VERIFIED_REPO_ID,
                "error": None
            }

        elif hasattr(_MODEL, "predict"):
            raw_pred = _MODEL.predict(features)[0]
            fraud_idx, fraud_val = locate_verified_fraud_class(_MODEL.classes_ if hasattr(_MODEL, "classes_") else [0, 1])
            predicted_class = "fraud" if raw_pred == fraud_val else "legitimate"
            ml_risk_score = 75.0 if predicted_class == "fraud" else 20.0

            return {
                "available": True,
                "predicted_class": predicted_class,
                "ml_risk_score": ml_risk_score,
                "ml_confidence": None,
                "score_semantics": "discrete_class_prediction",
                "model_name": _MODEL_METADATA["model_name"],
                "model_version": VERIFIED_REPO_ID,
                "error": None
            }

        else:
            return {
                "available": False,
                "predicted_class": "unknown",
                "ml_risk_score": None,
                "ml_confidence": None,
                "score_semantics": _MODEL_METADATA["score_semantics"],
                "model_name": _MODEL_METADATA["model_name"],
                "model_version": VERIFIED_REPO_ID,
                "error": "Loaded model object lacks predict or predict_proba methods"
            }

    except Exception as exc:
        logger.error("Inference failed in predict_employment_fraud: %s", exc)
        return {
            "available": False,
            "predicted_class": "unknown",
            "ml_risk_score": None,
            "ml_confidence": None,
            "score_semantics": _MODEL_METADATA["score_semantics"],
            "model_name": _MODEL_METADATA["model_name"],
            "model_version": VERIFIED_REPO_ID,
            "error": str(exc)
        }
