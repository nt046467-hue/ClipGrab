'use server';
/**
 * @fileOverview A Genkit flow for resolving video metadata from a URL.
 *
 * - resolveMetadata - A function that extracts realistic metadata from a video URL.
 * - ResolveMetadataInput - The input type for the resolveMetadata function.
 * - ResolveMetadataOutput - The return type for the resolveMetadata function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ResolveMetadataInputSchema = z.object({
  url: z.string().url().describe('The URL of the video to resolve.'),
});
export type ResolveMetadataInput = z.infer<typeof ResolveMetadataInputSchema>;

const ResolveMetadataOutputSchema = z.object({
  title: z.string().describe('The title of the video.'),
  author: z.string().describe('The author or channel name.'),
  duration: z.string().describe('The duration of the video (e.g., 12:45).'),
  thumbnailHint: z.string().describe('A 1-2 word keyword for searching a thumbnail image.'),
});
export type ResolveMetadataOutput = z.infer<typeof ResolveMetadataOutputSchema>;

export async function resolveMetadata(input: ResolveMetadataInput): Promise<ResolveMetadataOutput> {
  return resolveMetadataFlow(input);
}

const resolveMetadataPrompt = ai.definePrompt({
  name: 'resolveMetadataPrompt',
  input: {schema: ResolveMetadataInputSchema},
  output: {schema: ResolveMetadataOutputSchema},
  prompt: `You are a video metadata extractor. Given a URL, provide a realistic title, author, and duration as if you were a scraper. 
  
  URL: {{url}}
  
  If the URL hints at a specific topic (e.g., 'coding', 'cooking', 'music'), tailor the title and author to that topic.
  The thumbnailHint should be a simple search keyword (e.g., 'code', 'food', 'concert').`,
});

const resolveMetadataFlow = ai.defineFlow(
  {
    name: 'resolveMetadataFlow',
    inputSchema: ResolveMetadataInputSchema,
    outputSchema: ResolveMetadataOutputSchema,
  },
  async input => {
    const {output} = await resolveMetadataPrompt(input);
    return output!;
  }
);
