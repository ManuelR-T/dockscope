<!--
  Dismisses a panel, dialog, or overlay.

  Deliberately exposes no styling props. Closing is one job, so every close
  affordance in the app is identical by construction. Before this existed the
  five close buttons had five different variant/size/glyph combinations.
-->
<script lang="ts">
  import IconButton from './IconButton.svelte';

  interface Props {
    /** Describes what is being closed, for the tooltip and accessible name. */
    label?: string;
    onclick: () => void;
  }

  let { label = 'Close', onclick }: Props = $props();
</script>

<IconButton variant="outline" size={22} glyphSize={15} title={label} {onclick}>&times;</IconButton>
