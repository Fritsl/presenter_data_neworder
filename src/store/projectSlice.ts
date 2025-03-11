import { StateCreator } from 'zustand';
import { NoteStore, Note } from '../types';
import { supabase } from '../lib/supabase';

export const createProjectSlice: StateCreator<NoteStore> = (set, get) => ({
  title: 'New Project',
  projects: [],

  loadProjects: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { data: projects, error } = await supabase
      .from('settings')
      .select('*')
      .eq('user_id', userData.user.id)
      .order('created_at');

    if (error) {
      console.error('Error loading projects:', error);
      return;
    }

    set({ projects: projects || [] });
  },

  switchProject: async (projectId: string) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    try {
      const { data: project } = await supabase
        .from('settings')
        .select('*')
        .eq('user_id', userData.user.id)
        .eq('id', projectId)
        .single();

      if (project) {
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
          console.error('Error loading notes:', error);
          return;
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
      }
    } catch (error) {
      console.error('Error switching project:', error);
    }
  },

  deleteProject: async (id: string) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    
    const urlParams = new URLSearchParams(window.location.search);
    const currentProjectId = urlParams.get('project');

    try {
      const { error: projectError } = await supabase
        .from('settings')
        .delete()
        .eq('id', id)
        .eq('user_id', userData.user.id);

      if (projectError) throw projectError;

      if (currentProjectId === id) {
        const { data: remainingProjects } = await supabase
          .from('settings')
          .select()
          .eq('user_id', userData.user.id)
          .order('created_at')
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
        .eq('user_id', userData.user.id)
        .order('created_at');

      set({ projects: updatedProjects || [] });

    } catch (error) {
      console.error('Error deleting project:', error instanceof Error ? error.message : error);
      throw error;
    }
  }
});