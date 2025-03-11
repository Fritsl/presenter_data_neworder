import { StateCreator } from 'zustand';
import { Store } from '../types';
import { supabase } from '../../lib/supabase';
import { getUniqueTitle } from '../../lib/utils';

export const createProjectSlice: StateCreator<Store> = (set, get) => ({
  title: 'New Project',
  projects: [],

  updateTitle: async (title: string) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('project');
    if (!projectId) return;

    try {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        throw new Error('Title cannot be empty');
      }
      if (trimmedTitle.length > 50) {
        throw new Error('Title cannot be longer than 50 characters');
      }
      if (!/^[a-zA-Z0-9\s\-_.,!?()]+$/.test(trimmedTitle)) {
        throw new Error('Title can only contain letters, numbers, spaces, and basic punctuation');
      }
      
      const { data: existingProject } = await supabase
        .from('settings')
        .select('id')
        .eq('user_id', userData.user.id)
        .eq('title', trimmedTitle)
        .neq('id', projectId)
        .is('deleted_at', null)
        .maybeSingle();

      if (existingProject) {
        throw new Error('A project with this title already exists');
      }

      const { error } = await supabase
        .from('settings')
        .update({
          title: trimmedTitle,
          updated_at: new Date().toISOString()
        })
        .eq('id', projectId)
        .eq('user_id', userData.user.id);

      if (error) throw error;

      set({ title: trimmedTitle });

      set(state => ({
        projects: state.projects.map(p =>
          p.id === projectId ? {
            ...p,
            title: trimmedTitle,
            updated_at: new Date().toISOString()
          } : p
        )
      }));
    } catch (error) {
      console.error('Error updating title:', error);
      throw error;
    }
  },

  loadProjects: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { data: projects, error } = await supabase
      .from('settings')
      .select('*')
      .is('deleted_at', null)
      .eq('user_id', userData.user.id)
      .order('last_modified_at', { ascending: false, nullsLast: true });

    if (error) {
      console.error('Error loading projects:', error);
      return;
    }

    set({ projects: projects || [] });
  },

  switchProject: async (projectId: string) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    
    set({ notes: [] });

    try {
      const { data: project, error: projectError } = await supabase
        .from('settings')
        .select('*')
        .is('deleted_at', null)
        .eq('user_id', userData.user.id)
        .eq('id', projectId)
        .single();

      if (projectError || !project) {
        throw new Error('Project not found');
      }

      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('project', project.id);
      window.history.replaceState({}, '', newUrl.toString());

      set({ title: project.title });

      const { data: notes, error } = await supabase
        .from('notes')
        .select(`
          *,
          images:note_images(*)
        `)
        .eq('user_id', userData.user.id)
        .eq('project_id', projectId)
        .order('position');

      if (error) {
        throw new Error('Failed to load notes');
      }

      const noteMap = new Map(notes?.map(note => ({
        ...note,
        images: note.images?.sort((a, b) => a.position - b.position) || [],
        children: []
      })).map(note => [note.id, note]) ?? []);
      const rootNotes: Note[] = [];

      notes?.forEach(note => {
        const noteWithChildren = noteMap.get(note.id);
        if (noteWithChildren) {
          if (note.parent_id && noteMap.has(note.parent_id)) {
            const parent = noteMap.get(note.parent_id);
            parent?.children.push(noteWithChildren);
          } else {
            rootNotes.push(noteWithChildren);
          }
        }
      });

      set({ notes: rootNotes });
    } catch (error) {
      console.error('Error switching project:', error);
      throw error;
    }
  },

  deleteProject: async (id: string) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const urlParams = new URLSearchParams(window.location.search);
    const currentProjectId = urlParams.get('project');

    try {
      const { error: projectError } = await supabase.rpc('soft_delete_project', {
        project_id: id
      });

      if (projectError) throw projectError;

      if (currentProjectId === id) {
        const { data: remainingProjects } = await supabase
          .from('settings')
          .select()
          .is('deleted_at', null)
          .eq('user_id', userData.user.id)
          .order('last_modified_at', { ascending: false, nullsLast: true })
          .limit(1);

        if (remainingProjects && remainingProjects.length > 0) {
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.set('project', remainingProjects[0].id);
          window.history.replaceState({}, '', newUrl.toString());
          await get().switchProject(remainingProjects[0].id);
        } else {
          const { data: newProject } = await supabase
            .from('settings')
            .insert({
              user_id: userData.user.id,
              title: 'New Project'
            })
            .select()
            .single();

          if (newProject) {
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.set('project', newProject.id);
            window.history.replaceState({}, '', newUrl.toString());
            await get().switchProject(newProject.id);
          }
        }
      }

      const { data: updatedProjects } = await supabase
        .from('settings')
        .select('*')
        .is('deleted_at', null)
        .eq('user_id', userData.user.id)
        .order('created_at');

      set({ projects: updatedProjects || [] });

    } catch (error) {
      console.error('Error deleting project:', error);
      throw error;
    }
  },

  copyProject: async (id: string) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    try {
      const { data: sourceProject } = await supabase
        .from('settings')
        .select('*')
        .eq('id', id)
        .single();

      if (!sourceProject) {
        throw new Error('Source project not found');
      }

      const uniqueTitle = await getUniqueTitle(userData.user.id, `${sourceProject.title} (Copy)`);

      const { data: newProject, error: projectError } = await supabase
        .from('settings')
        .insert({
          user_id: userData.user.id,
          title: uniqueTitle,
          description: sourceProject.description
        })
        .select()
        .single();

      if (projectError || !newProject) {
        throw new Error('Failed to create new project');
      }

      const { data: sourceNotes, error: notesError } = await supabase
        .from('notes')
        .select(`
          *,
          images:note_images(*)
        `)
        .eq('project_id', id)
        .order('position');

      if (notesError) {
        throw new Error('Failed to fetch source notes');
      }

      if (!sourceNotes || sourceNotes.length === 0) {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('project', newProject.id);
        window.history.replaceState({}, '', newUrl.toString());
        await get().switchProject(newProject.id);
        return;
      }

      const idMap = new Map<string, string>();
      
      for (const note of sourceNotes) {
        const newId = crypto.randomUUID();
        idMap.set(note.id, newId);
        
        await supabase
          .from('notes')
          .insert({
            id: newId,
            content: note.content,
            parent_id: null,
            user_id: userData.user.id,
            project_id: newProject.id,
            position: note.position,
            is_discussion: note.is_discussion
          });
      }

      for (const note of sourceNotes) {
        if (note.parent_id) {
          const newParentId = idMap.get(note.parent_id);
          if (newParentId) {
            await supabase
              .from('notes')
              .update({ parent_id: newParentId })
              .eq('id', idMap.get(note.id));
          }
        }
      }

      for (const note of sourceNotes) {
        if (note.images && note.images.length > 0) {
          for (const image of note.images) {
            await supabase
              .from('note_images')
              .insert({
                note_id: idMap.get(note.id),
                url: image.url,
                storage_path: image.storage_path,
                position: image.position
              });
          }
        }
      }

      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('project', newProject.id);
      window.history.replaceState({}, '', newUrl.toString());
      await get().switchProject(newProject.id);
    } catch (error) {
      console.error('Error copying project:', error);
      throw error;
    }
  },

  loadNotes: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    try {
      const { data: existingSettings, error: settingsError } = await supabase
        .from('settings')
        .select()
        .is('deleted_at', null)
        .eq('user_id', userData.user.id)
        .order('last_modified_at', { ascending: false, nullsLast: true });

      if (settingsError) {
        console.error('Error loading settings:', settingsError);
        return;
      }

      if (existingSettings && existingSettings.length > 0) {
        const urlParams = new URLSearchParams(window.location.search);
        const projectId = urlParams.get('project');

        let currentProject = projectId 
          ? existingSettings.find(p => p.id === projectId) 
          : existingSettings[0];

        if (!currentProject) {
          currentProject = existingSettings[0];
        }

        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('project', currentProject.id);
        window.history.replaceState({}, '', newUrl.toString());

        set({ 
          title: currentProject.title,
          projects: existingSettings
        });

        // First get the sequences to determine order
        const { data: sequences } = await supabase
          .from('note_sequences')
          .select('note_id, sequence')
          .eq('project_id', currentProject.id)
          .order('sequence');

        const orderMap = new Map(sequences?.map(s => [s.note_id, s.sequence]) || []);

        // Then get notes with their images
        // First get the sequences to determine order
        const { data: sequences } = await supabase
          .from('note_sequences')
          .select('note_id, sequence')
          .eq('project_id', currentProject.id)
          .order('sequence');

        const orderMap = new Map(sequences?.map(s => [s.note_id, s.sequence]) || []);

        // Then get the notes with their images
        const { data: notes, error } = await supabase
          .from('notes')
          .select(`
            *,
            images:note_images(*),
            sequence:note_sequences!inner(sequence)
          .order('note_sequences.sequence');

        if (error) {
          console.error('Error loading notes:', error);
          return;
        }

        // Sort notes based on sequence
        const sortedNotes = notes?.sort((a, b) => {
          const seqA = orderMap.get(a.id) || 0;
          const seqB = orderMap.get(b.id) || 0;
          return seqA - seqB;
        });

        const noteMap = new Map(notes?.map(note => ({
          ...note,
          images: note.images?.sort((a, b) => a.position - b.position) || [],
          children: []
        })).map(note => [note.id, note]) ?? []);
        const rootNotes: Note[] = [];

        sortedNotes?.forEach(note => {
          const noteWithChildren = noteMap.get(note.id)!;
          if (note.parent_id) {
            const parent = noteMap.get(note.parent_id);
            if (parent) {
              parent.children.push(noteWithChildren);
            }
          } else {
            rootNotes.push(noteWithChildren);
          }
        });

        set({ notes: rootNotes });
      } else {
        const { data: newSettings } = await supabase
          .from('settings')
          .insert({
            user_id: userData.user.id,
            title: 'New Project'
          })
          .select()
          .single();

        if (!newSettings) {
          console.error('Failed to create initial project');
          return;
        }

        set({ 
          title: newSettings.title,
          projects: [newSettings],
          notes: []
        });

        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('project', newSettings.id);
        window.history.replaceState({}, '', newUrl.toString());
      }
    } catch (error) {
      console.error('Error in loadNotes:', error);
    }
  }
});
          )
      }
    }
  }
}
)
          )
      }
    }
  }
}
)
          )
      }
    }
  }
}
)
          )
      }
    }
  }
}
)
          )
      }
    }
  }
}
)