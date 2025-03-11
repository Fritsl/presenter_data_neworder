import React from 'react';
import { ImageIcon, Users } from 'lucide-react';
import { Note } from '../../types';

interface NoteContentProps {
  note: Note;
  level: number;
}

const linkify = (text: string) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.split(urlRegex).map((part, i) => {
    if (part.match(urlRegex)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 underline"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return part;
  });
};

const getLevelStyles = (level: number = 0): string => {
  switch (level) {
    case 0:
      return 'text-xl font-semibold text-gray-900';
    case 1:
      return 'text-lg font-medium text-gray-800';
    case 2:
      return 'text-base font-medium text-gray-700';
    default:
      return 'text-sm text-gray-600';
  }
};

export const NoteContent: React.FC<NoteContentProps> = ({ note, level }) => {
  return (
    <div className={`whitespace-pre-wrap break-words ${getLevelStyles(level)}`}>
      <div className="flex items-center gap-2">
        <span>{linkify(note.content || 'Empty note...')}</span>
        {note.images && note.images.length > 0 && (
          <span className="text-gray-400">
            <ImageIcon className="w-4 h-4" />
          </span>
        )}
        {note.is_discussion && (
          <Users className="w-4 h-4 text-blue-500" />
        )}
      </div>
    </div>
  );
};