'use server';
/**
 * @fileOverview A Genkit flow for summarizing video content from a URL.
 *
 * - summarizeVideoContent - A function that triggers the video content summarization process.
 * - SummarizeVideoContentInput - The input type for the summarizeVideoContent function.
 * - SummarizeVideoContentOutput - The return type for the summarizeVideoContent function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SummarizeVideoContentInputSchema = z.object({
  videoUrl: z.string().url().describe('The URL of the video to summarize.'),
});
export type SummarizeVideoContentInput = z.infer<typeof SummarizeVideoContentInputSchema>;

const SummarizeVideoContentOutputSchema = z.object({
  summary: z.string().describe('A concise summary of the video content.'),
});
export type SummarizeVideoContentOutput = z.infer<typeof SummarizeVideoContentOutputSchema>;

export async function summarizeVideoContent(input: SummarizeVideoContentInput): Promise<SummarizeVideoContentOutput> {
  return summarizeVideoContentFlow(input);
}

const summarizeVideoContentPrompt = ai.definePrompt({
  name: 'summarizeVideoContentPrompt',
  input: {schema: SummarizeVideoContentInputSchema},
  output: {schema: SummarizeVideoContentOutputSchema},
  prompt: `Please provide a concise summary of the content of the following video. The summary should be no more than 3-5 sentences.

{{media url=videoUrl}}`,
});

const summarizeVideoContentFlow = ai.defineFlow(
  {
    name: 'summarizeVideoContentFlow',
    inputSchema: SummarizeVideoContentInputSchema,
    outputSchema: SummarizeVideoContentOutputSchema,
  },
  async input => {
    const {output} = await summarizeVideoContentPrompt(input);
    return output!;
  }
);
