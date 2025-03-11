import React, { useEffect, useRef } from 'react';
import { X, Users, Image as ImageIcon } from 'lucide-react';
import { Note } from '../types';
import { useNoteStore } from '../store';

interface FullscreenEditorProps {
  content: string;
  note: Note;
  onChange: (content: string) => void;
  onClose: () => void;
  sequenceNumber?: number;
  isNew?: boolean;
}

export const FullscreenEditor = ({
  content,
  note,
  onChange,
  onClose,
  sequenceNumber,
  isNew = false,
}: FullscreenEditorProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { 
    saveNote, 
    toggleDiscussion, 
    addImage, 
    removeImage,
    updateNote 
  } = useNoteStore();

  const handleImageUpload = async (file: File) => {
    console.log('Starting image upload process', { fileName: file.name, fileSize: file.size });

    // Validate file type
    if (!file.type.startsWith('image/')) {
      console.error('Invalid file type:', file.type);
      setError('Please select an image file');
      return;
    }

    // Validate file size
    if (file.size > 5 * 1024 * 1024) {
      console.error('File too large:', file.size);
      setError('Image size must be less than 5MB');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      console.log('Creating FileReader instance');
      const reader = new FileReader();

      reader.onerror = (error) => {
        console.error('FileReader error:', error);
        setError('Failed to read image file');
        setIsUploading(false);
      };

      reader.onloadend = async () => {
        console.log('FileReader loaded successfully');
        if (!reader.result) {
          console.error('FileReader result is null');
          setError('Failed to read image file');
          setIsUploading(false);
          return;
        }

        const dataUrl = reader.result as string;
        console.log('Data URL created, length:', dataUrl.length);

        try {
          console.log('Adding image to note:', { noteId: note.id });
          await addImage(note.id, dataUrl);
          console.log('Image added successfully');
        } catch (error) {
          console.error('Error adding image:', error);
          setError('Failed to add image');
        } finally {
          setIsUploading(false);
        }
      };

      console.log('Starting file read');
      reader.readAsDataURL(file);
      console.log('File read initiated');
    } catch (err) {
      console.error('Error in handleImageUpload:', err);
      setError('Failed to upload image');
      setIsUploading(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('File input change event triggered', {
      event: e.type,
      hasFiles: e.target.files && e.target.files.length > 0,
      fileCount: e.target.files?.length || 0,
      target: {
        id: e.target.id,
        name: e.target.name,
        type: e.target.type,
        value: e.target.value,
        files: e.target.files ? Array.from(e.target.files).map(f => ({
          name: f.name,
          type: f.type,
          size: f.size,
          lastModified: new Date(f.lastModified).toISOString()
        })) : []
      }
    });

    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      console.log('File selected:', {
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: new Date(file.lastModified).toISOString()
      });

      if (!file.type.startsWith('image/')) {
        setError('Only image files are allowed');
        return;
      }

      setIsUploading(true);
      setError(null);
      handleImageUpload(file);
    } else {
      console.log('No files selected in change event');
    }
  };

  const triggerFileUpload = () => {
    console.log('Triggering file input click', {
      fileInputExists: !!fileInputRef.current,
      fileInputType: fileInputRef.current ? typeof fileInputRef.current : 'N/A',
      fileInputAttributes: fileInputRef.current ? {
        type: fileInputRef.current.type,
        accept: fileInputRef.current.accept,
        hidden: fileInputRef.current.hidden,
        id: fileInputRef.current.id,
        className: fileInputRef.current.className,
      } : 'N/A'
    });
    
    try {
      if (fileInputRef.current) {
        console.log('About to click file input');
        // Reset value to ensure onChange triggers even when selecting the same file again
        fileInputRef.current.value = '';
        
        // Use a direct click approach first
        fileInputRef.current.click();
        console.log('Direct click called on file input');
        
        // Add a fallback method with a short delay
        setTimeout(() => {
          console.log('Fallback method: trying click again after delay');
          if (fileInputRef.current) {
            try {
              // Create and dispatch a mouse event as a backup approach
              const clickEvent = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true,
              });
              fileInputRef.current.dispatchEvent(clickEvent);
              console.log('Dispatched synthetic click event');
            } catch (err) {
              console.error('Error in fallback click method:', err);
            }
          }
        }, 100);
      } else {
        console.error('File input reference is null');
      }
    } catch (error) {
      console.error('Error triggering file upload:', error);
    }
  };

  useEffect(() => {
    textareaRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        saveNote(note.id);
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, note.id, saveNote]);

  const handleClose = () => {
    saveNote(note.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">
            {isNew ? 'New note' : `Edit note ${sequenceNumber || ''}`}
          </h2>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 p-4 resize-none focus:outline-none text-lg mb-4"
          placeholder="Enter your note..."
        />
        <div className="px-4">
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => toggleDiscussion(note.id, !note.is_discussion)}
              className={`px-4 py-2 text-sm font-medium flex items-center gap-2 rounded-lg transition-colors ${
                note.is_discussion 
                  ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' 
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Users className="w-4 h-4" />
              {note.is_discussion ? 'Discussion' : 'Mark as Discussion'}
            </button>
          </div>
          {note.images && note.images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {note.images.map((image) => (
                <div key={image.id} className="relative group">
                  <img
                    src={image.url}
                    alt=""
                    className="w-32 h-32 object-cover rounded-lg"
                  />
                  <button
                    onClick={() => {
                      console.log('Image delete button clicked:', {
                        noteId: note.id,
                        imageId: image.id,
                        imageUrl: image.url
                      });
                      removeImage(note.id, image.id)}
                    }
                    className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mb-4">
            <input 
              type="file" 
              accept="image/*"
              onChange={handleFileInputChange}
              style={{ 
                position: 'absolute', 
                width: '1px', 
                height: '1px', 
                padding: '0', 
                margin: '-1px', 
                overflow: 'hidden', 
                clip: 'rect(0,0,0,0)', 
                border: '0' 
              }}
              id="file-upload-input"
              ref={fileInputRef}
            />
            <button
              onClick={triggerFileUpload}
              disabled={isUploading}
              className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ImageIcon className="w-4 h-4" />
              {isUploading ? 'Uploading...' : 'Add Image'}
            </button>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </div>
        </div>
        <div className="p-4 border-t bg-gray-50 flex justify-end">
          <button
            onClick={handleClose}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};