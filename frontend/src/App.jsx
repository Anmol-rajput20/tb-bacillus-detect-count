
import {useRef, useState } from "react";
import { useEffect } from "react";
import "./App.css";

const API_URL =
  import.meta.env.VITE_API_URL ||
  "https://tb-bacillus-vision-api.onrender.com";
const ACCEPTED_TYPES = ".jpg,.jpeg,.png,.bmp";
const MAX_FILES = 20;
const MAX_SIZE = 15 * 1024 * 1024;

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function formatImageUrl(result) {
  if (!result?.annotated_image) return "";
  return `data:image/${result.image_format || "jpeg"};base64,${result.annotated_image}`;
}


function ImagePreview({ file }) {
  const [preview, setPreview] = useState("");

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!preview) return null;

  return <img className="preview-image" src={preview} alt={file.name} />;
}

function ResultCard({ result, index }) {
  const imageUrl = formatImageUrl(result);

  return (
    <article className="result-card">
      <div className="result-card-heading">
        <div className="result-number">{String(index + 1).padStart(2, "0")}</div>
        <div className="result-file-info">
          <h3>{result.filename}</h3>
          <p>Microscopy image analysis</p>
        </div>
        <span className="status-pill">
          <span className="status-dot" />
          Processed
        </span>
      </div>

      {imageUrl && (
        <div className="annotated-image-wrap">
          <img
            className="annotated-image"
            src={imageUrl}
            alt={`Annotated detections in ${result.filename}`}
          />
        </div>
      )}

      <div className="result-metrics">
        <div className="result-metric">
          <span>Predicted count</span>
          <strong>{result.predicted_count}</strong>
        </div>
        <div className="result-metric">
          <span>Mean confidence</span>
          <strong>{formatPercent(result.mean_confidence)}</strong>
        </div>
      </div>

      <details className="detection-details">
        <summary>
          View detection confidence scores ({result.detections?.length || 0})
        </summary>
        {result.detections?.length > 0 ? (
          <div className="confidence-list">
            {result.detections.map((detection, detectionIndex) => (
              <div
                className="confidence-row"
                key={`${result.filename}-${detectionIndex}`}
              >
                <span>Detection {detectionIndex + 1}</span>
                <div className="confidence-track">
                  <div
                    className="confidence-fill"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(0, Number(detection.confidence) * 100)
                      )}%`,
                    }}
                  />
                </div>
                <strong>{formatPercent(detection.confidence)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-note">No detections were returned.</p>
        )}
      </details>
    </article>
  );
}

function App() {
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [errors, setErrors] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const resetResults = () => {
    setResults([]);
    setErrors([]);
    setSummary(null);
    setErrorMessage("");
  };

  const validateFiles = (incomingFiles) => {
    const selected = Array.from(incomingFiles || []);

    if (selected.length === 0) return [];

    if (files.length + selected.length > MAX_FILES) {
      setErrorMessage(`You can add up to ${MAX_FILES} images in total. You already have ${files.length} selected.`);
      return [];
    }

    const allowed = [".jpg", ".jpeg", ".png", ".bmp"];

    for (const file of selected) {
      const extension = `.${file.name.split(".").pop().toLowerCase()}`;

      if (!allowed.includes(extension)) {
        setErrorMessage(`Unsupported file: ${file.name}. Use JPG, PNG, or BMP.`);
        return [];
      }

      if (file.size > MAX_SIZE) {
        setErrorMessage(`${file.name} exceeds the 15 MB file-size limit.`);
        return [];
      }

      if (file.size === 0) {
        setErrorMessage(`${file.name} is empty.`);
        return [];
      }
    }

    setErrorMessage("");
    return selected;
  };

  const handleFiles = (incomingFiles) => {
    const selected = validateFiles(incomingFiles);
    if (selected.length > 0) {
      setFiles((currentFiles) => [...currentFiles, ...selected]);
      resetResults();
    }
  };

  const handleInputChange = (event) => {
    handleFiles(event.target.files);
    event.target.value = "";
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    handleFiles(event.dataTransfer.files);
  };

  const analyzeImages = async () => {
    if (!files.length || loading) return;

    setLoading(true);
    resetResults();

    try {
      const formData = new FormData();

      let endpoint;

      if (files.length === 1) {
        formData.append("file", files[0]);
        endpoint = `${API_URL}/predict`;
      } else {
        files.forEach((file) => formData.append("files", file));
        endpoint = `${API_URL}/predict/batch`;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "The server could not process your request."
        );
      }

      if (files.length === 1) {
        setResults([data]);
      } else {
        setResults(data.results || []);
        setErrors(data.errors || []);
        setSummary(data);
      }
    } catch (error) {
      setErrorMessage(
        error.message?.includes("Failed to fetch")
          ? "Cannot connect to the backend. Make sure FastAPI is running at http://127.0.0.1:8000."
          : error.message || "Something went wrong while analyzing the images."
      );
    } finally {
      setLoading(false);
    }
  };

  const clearAll = () => {
    setFiles([]);
    resetResults();
    if (inputRef.current) inputRef.current.value = "";
  };

  const totalDetections =
    summary?.total_detected_objects ??
    results.reduce((total, result) => total + (result.predicted_count || 0), 0);

  const averageConfidence =
    summary?.mean_confidence ??
    (results.length
      ? results.reduce((sum, result) => sum + (result.mean_confidence || 0), 0) /
        results.length
      : 0);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a href="#" className="brand" aria-label="Bacillus Vision home">
          <div className="brand-mark">
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="21" cy="19" r="4" stroke="currentColor" strokeWidth="1.5" />
              <path d="M7 21l4-2m10-9 3-2M15 23l-1 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <span className="brand-name">Bacillus Vision</span>
            <span className="brand-subtitle">MICROSCOPY ANALYSIS</span>
          </div>
        </a>

        <div className="connection-status">
          <span className="status-dot" />
          Local analysis workspace
        </div>
      </header>

      <main className="main-content">
        <section className="hero">
          <div className="eyebrow">
            <span className="eyebrow-line" />
            COMPUTER VISION · RESEARCH TOOL
          </div>
          <h1>
            See more clearly.
            <br />
            <span>Count with confidence.</span>
          </h1>
          <p>
            Analyze microscopy images with an experimental YOLO-based bacillus
            detection model. Review visual detections and confidence scores in
            one workspace.
          </p>
        </section>

        <section className="workspace">
          <div className="section-heading">
            <div>
              <span className="section-kicker">ANALYSIS WORKSPACE</span>
              <h2>Analyze microscopy images</h2>
            </div>
            <span className="model-tag">YOLO26m · Experimental</span>
          </div>

          <div
            className={`upload-zone ${dragging ? "dragging" : ""} ${
              files.length ? "has-files" : ""
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              multiple={false}
              onChange={handleInputChange}
              className="file-input"
              id="image-upload"
            />

            <div className="upload-icon">
              <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <path d="M16 21V5m0 0L9.5 11.5M16 5l6.5 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6 20v5a2 2 0 002 2h16a2 2 0 002-2v-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>

            <h3>
              {files.length
                ? `${files.length} of ${MAX_FILES} image${files.length === 1 ? "" : "s"} added`
                : "Add your first microscopy image"}
            </h3>
            <p>
              {files.length
                ? "Add images one at a time. You do not need to select them all together."
                : "Choose one image to start, then add more if you need to do the Batch Analysis."}
            </p>

            <label htmlFor="image-upload" className="browse-button">
              {files.length ? "Add another image" : "Choose first image"}
            </label>

            <div className="upload-hints">
              <span>JPG</span>
              <span>JPEG</span>
              <span>PNG</span>
              <span>BMP</span>
              <span>Max 15 MB per image</span>
            </div>
          </div>

          {errorMessage && (
            <div className="alert error-alert" role="alert">
              <span className="alert-symbol">!</span>
              <span>{errorMessage}</span>
              <button
                type="button"
                className="alert-close"
                onClick={() => setErrorMessage("")}
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}

          {files.length > 0 && (
            <div className="selected-files">
              <div className="selected-files-heading">
                <div>
                  <h3>Selected images</h3>
                  <p>{files.length} image{files.length === 1 ? "" : "s"} ready. Add more one at a time if needed.</p>
                </div>
                <button
                  type="button"
                  className="text-button"
                  onClick={clearAll}
                  disabled={loading}
                >
                  Clear all
                </button>
              </div>

              <div className="file-grid">
                {files.map((file, index) => (
                  <div className="file-item" key={`${file.name}-${file.size}-${index}`}>
                    <div className="file-thumbnail">
                      <ImagePreview file={file} />
                    </div>
                    <div className="file-item-info">
                      <span className="file-name" title={file.name}>
                        {file.name}
                      </span>
                      <span className="file-size">
                        {(file.size / (1024 * 1024)).toFixed(2)} MB
                      </span>
                    </div>
                    <span className="file-check" aria-label="Selected">
                      ✓
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="analysis-actions">
            <p>
              <span className="info-icon">i</span>
              {files.length === 1
                ? "One image will be analyzed. You can add more images before starting."
                : "Each image is analyzed individually; counts are then combined."}
            </p>
            <button
              type="button"
              className="analyze-button"
              onClick={analyzeImages}
              disabled={!files.length || loading}
            >
              {loading ? (
                <>
                  <span className="spinner" />
                  Analyzing images…
                </>
              ) : (
                <>
                  Analyze {files.length ? files.length : ""} image
                  {files.length === 1 ? "" : "s"}
                  <span aria-hidden="true">→</span>
                </>
              )}
            </button>
          </div>
        </section>

        {loading && (
          <section className="loading-panel" aria-live="polite">
            <div className="loading-spinner" />
            <div>
              <h3>Analyzing your images</h3>
              <p>The model is processing the selected microscopy images.</p>
            </div>
          </section>
        )}

        {summary && !loading && (
          <section className="summary-section">
            <div className="section-heading">
              <div>
                <span className="section-kicker">BATCH REPORT</span>
                <h2>Analysis summary</h2>
              </div>
              <span className="status-pill">
                <span className="status-dot" />
                Complete
              </span>
            </div>

            <div className="summary-grid">
              <div className="summary-card">
                <span>Images processed</span>
                <strong>{summary.successful_images}</strong>
                <small>of {summary.total_images_received} received</small>
              </div>
              <div className="summary-card highlight-card">
                <span>Total predicted detections</span>
                <strong>{summary.total_detected_objects}</strong>
                <small>Across successful images</small>
              </div>
              <div className="summary-card">
                <span>Mean confidence</span>
                <strong>{formatPercent(summary.mean_confidence)}</strong>
                <small>Across returned detections</small>
              </div>
              <div className="summary-card">
                <span>Failed images</span>
                <strong>{summary.failed_images}</strong>
                <small>
                  {summary.failed_images ? "Review errors below" : "No errors reported"}
                </small>
              </div>
            </div>
          </section>
        )}

        {results.length > 0 && !loading && (
          <section className="results-section">
            <div className="section-heading">
              <div>
                <span className="section-kicker">
                  {summary ? "IMAGE-BY-IMAGE BREAKDOWN" : "PREDICTION REPORT"}
                </span>
                <h2>{summary ? "Individual image results" : "Detection results"}</h2>
              </div>
              <span className="result-count">
                {results.length} result{results.length !== 1 ? "s" : ""}
              </span>
            </div>

            {!summary && (
              <div className="single-summary">
                <div>
                  <span>Predicted detections</span>
                  <strong>{totalDetections}</strong>
                </div>
                <div>
                  <span>Mean confidence</span>
                  <strong>{formatPercent(averageConfidence)}</strong>
                </div>
                <div>
                  <span>Detection threshold</span>
                  <strong>{formatPercent(results[0].confidence_threshold)}</strong>
                </div>
              </div>
            )}

            <div className="results-grid">
              {results.map((result, index) => (
                <ResultCard
                  key={`${result.filename}-${index}`}
                  result={result}
                  index={index}
                />
              ))}
            </div>
          </section>
        )}

        {errors.length > 0 && !loading && (
          <section className="failed-section">
            <h3>Images that could not be processed</h3>
            {errors.map((item, index) => (
              <div className="failed-item" key={`${item.filename}-${index}`}>
                <strong>{item.filename}</strong>
                <span>{item.error}</span>
              </div>
            ))}
          </section>
        )}

        {results.length > 0 && !loading && (
          <div className="report-actions">
            <p>Review the annotated images and detection scores before drawing conclusions.</p>
            <button type="button" className="secondary-button" onClick={clearAll}>
              Start new analysis
            </button>
          </div>
        )}

        <section className="disclaimer">
          <div className="disclaimer-icon">!</div>
          <div>
            <h3>Research-use disclaimer</h3>
            <p>
              This application provides experimental computer-vision detections
              only. Predicted counts and confidence scores are not measures of
              diagnostic certainty, and this model is not a clinically validated
              diagnostic tool. Results require expert review and independent
              validation.
            </p>
          </div>
        </section>

        <footer className="footer">
          <span>Bacillus Vision</span>
          <span>Experimental microscopy analysis</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
