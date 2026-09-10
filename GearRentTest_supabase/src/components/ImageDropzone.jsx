import { useCallback, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import './ImageDropzone.css';

const BUCKET = 'gear-images';
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB

function isImageFile(file) {
  return file.type.startsWith('image/');
}

function randomId() {
  return (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

async function uploadToStorage(file, folder) {
  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${folder}/${randomId()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'image/jpeg',
  });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Drag-and-drop (or click-to-browse) image uploader. Files are uploaded
 * straight to Supabase Storage and the resulting public URLs are handed
 * back via onChange — no manual URL typing, no hardcoded image data.
 *
 * value: string[] of image URLs already attached
 * onChange: (nextUrls: string[]) => void
 * folder: storage path prefix, e.g. `products/${userId}`
 */
export default function ImageDropzone({ value = [], onChange, folder, maxFiles = 8, label = 'Drag photos here' }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const dragCounter = useRef(0);

  const acceptFiles = useCallback(async (fileList) => {
    setError('');
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const room = Math.max(0, maxFiles - value.length);
    if (!room) {
      setError(`You can attach up to ${maxFiles} photos.`);
      return;
    }

    const validFiles = [];
    for (const file of incoming.slice(0, room)) {
      if (!isImageFile(file)) {
        setError('Only image files are accepted.');
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError('Each photo must be under 8MB.');
        continue;
      }
      validFiles.push(file);
    }
    if (!validFiles.length) return;

    setIsUploading(true);
    try {
      const uploadedUrls = await Promise.all(validFiles.map((file) => uploadToStorage(file, folder)));
      onChange([...value, ...uploadedUrls]);
    } catch (uploadFailure) {
      console.error('Image upload failed', uploadFailure);
      setError('Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  }, [value, onChange, folder, maxFiles]);

  const handleDragEnter = (event) => {
    event.preventDefault();
    dragCounter.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    acceptFiles(event.dataTransfer.files);
  };

  const handleBrowse = (event) => {
    acceptFiles(event.target.files);
    event.target.value = '';
  };

  const removeImage = (urlToRemove) => {
    onChange(value.filter((url) => url !== urlToRemove));
  };

  return (
    <div className="image-dropzone-wrap">
      <div
        className={`image-dropzone ${isDragging ? 'is-dragging' : ''} ${isUploading ? 'is-uploading' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        aria-label="Upload gear photos by dragging them here or clicking to browse"
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="image-dropzone-input"
          onChange={handleBrowse}
        />
        <span className="image-dropzone-icon" aria-hidden="true">{isUploading ? '⟳' : '⇪'}</span>
        <span className="image-dropzone-label">{isUploading ? 'Uploading…' : label}</span>
        <span className="image-dropzone-hint">or click to browse · PNG/JPG up to 8MB</span>
      </div>

      {error && <p className="image-dropzone-error" role="alert">{error}</p>}

      {value.length > 0 && (
        <div className="image-dropzone-grid">
          {value.map((url, index) => (
            <div className="image-dropzone-thumb" key={url}>
              <img src={url} alt={`Upload ${index + 1}`} />
              {index === 0 && <span className="image-dropzone-primary">Cover</span>}
              <button
                type="button"
                className="image-dropzone-remove"
                onClick={(event) => { event.stopPropagation(); removeImage(url); }}
                aria-label={`Remove photo ${index + 1}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
