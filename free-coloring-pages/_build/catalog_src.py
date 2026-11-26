#!/usr/bin/env python3
"""Source of truth for the coloring-page catalog. Builds catalog.json (site) and batch request files (generation)."""
import json, os, sys

THEMES = [
    ("thanksgiving", "Thanksgiving", "🦃"),
    ("christmas", "Christmas", "🎄"),
    ("halloween", "Halloween", "🎃"),
    ("easter", "Easter & Spring", "🐣"),
    ("valentines", "Valentine's Day", "💘"),
    ("summer", "Summer & 4th of July", "🎆"),
    ("holidays", "More Holidays", "🎉"),
    ("dinosaurs", "Dinosaurs", "🦕"),
    ("ocean", "Ocean", "🐙"),
    ("animals", "Animals", "🦊"),
    ("space", "Space & Robots", "🚀"),
    ("fantasy", "Dragons & Unicorns", "🐉"),
]

STYLES = {
    "easy": "Style: bold and easy coloring page for toddlers and preschoolers, very thick uniform black outlines, large simple shapes, big open areas to color, cute friendly cartoon look with simple smiling faces, minimal background detail.",
    "whimsical": "Style: whimsical storybook coloring page for kids ages 6 to 10, medium-weight clean outlines, charming hand-drawn cartoon characters, playful full scene with a fun background, moderate detail.",
    "realistic": "Style: realistic, naturalistic coloring page for teens and adults, accurate anatomy and proportions drawn like a detailed pen-and-ink illustration, fine confident contour lines, texture detail shown with outline only, rich scenic background.",
    "intricate": "Style: intricate adult coloring book page, fine detailed linework, every element filled with ornate decorative patterns (zentangle, mandala, floral and paisley motifs), dense detailed composition with many small enclosed areas to color.",
}
TAIL = ("Pure black line art on a pure white background, clean crisp closed outlines, no shading, no hatching, no gray tones, no color, "
        "no solid black filled areas, no text, no letters, no numbers, no signature, no watermark, no border or frame. "
        "The whole illustration fits inside the page with a clear white margin on all four sides.")

# theme -> style -> [(title, subject)]
P = {}

P["thanksgiving"] = {
 "easy": [
  ("Pilgrim Hat Turkey", "A happy cartoon turkey wearing a pilgrim hat standing next to a big pumpkin."),
  ("Big Pumpkin Pie", "A big whole pumpkin pie with a dollop of whipped cream on top and one slice cut out on a plate beside it."),
  ("Smiling Pumpkin Patch", "Three round pumpkins of different sizes with curly vines and big leaves, the middle one with a smiling face."),
  ("Ear of Corn Buddies", "Two smiling cartoon ears of corn with husks, holding hands."),
  ("Acorn and Oak Leaf", "One giant acorn with a little face and two big oak leaves."),
  ("Thankful Little Bear", "A chubby teddy bear in a scarf hugging a basket of apples."),
 ],
 "whimsical": [
  ("Woodland Feast", "A family of woodland animals (fox, rabbit, squirrel, owl) sharing a Thanksgiving feast at a long table under autumn trees, with pies, corn and a pumpkin centerpiece."),
  ("Turkey Trot Parade", "A silly parade of turkeys marching down a small-town street playing drums and trumpets, with bunting and falling leaves."),
  ("Scarecrow's Pumpkin Farm", "A friendly scarecrow in a pumpkin field with crows on his arms, a red barn, a tractor pulling a hay wagon full of kids' pumpkins."),
  ("Leaf Pile Jump", "Children and a dog jumping into a huge pile of autumn leaves in a backyard with a rake, a wheelbarrow and a tree house."),
  ("Grandma's Kitchen", "A cozy kitchen with a grandmother and two kids rolling pie dough, a cat on a stool, pies cooling on the windowsill and a turkey in the oven."),
  ("Hot Air Balloon Harvest", "A giant turkey-shaped hot air balloon floating over patchwork farm fields, hay bales and a winding river."),
 ],
 "realistic": [
  ("Wild Tom Turkey", "A wild tom turkey in full strut display in an autumn forest clearing, with fallen oak leaves, acorns and a split-rail fence."),
  ("Harvest Table Still Life", "A realistic still life of a roast turkey on a platter surrounded by a pie, a gravy boat, candles, squash, grapes and wheat stalks on a wooden table."),
  ("Old Farm in Autumn", "An old wooden barn with a silo and windmill, a rail fence, corn shocks and pumpkins in the foreground, bare trees and rolling hills behind."),
  ("Whitetail Buck", "A whitetail deer buck standing in a harvested cornfield at the edge of autumn woods, detailed antlers and fur."),
  ("Squirrel with Acorns", "A realistic gray squirrel sitting on an oak branch holding an acorn, surrounded by detailed oak leaves and acorn clusters."),
  ("Sunflowers and Gourds", "A realistic arrangement of sunflowers, heirloom pumpkins, warty gourds and Indian corn in a wicker basket on a porch step."),
 ],
 "intricate": [
  ("Cornucopia Mandala", "An overflowing harvest cornucopia with pumpkins, gourds, corn, grapes, apples, sunflowers and autumn leaves."),
  ("Patterned Turkey", "A grand turkey seen from the front with its tail fanned out like a mandala, every feather filled with a different pattern."),
  ("Autumn Leaf Wreath", "A circular wreath of maple, oak and aspen leaves, berries, acorns and pinecones with a patterned pumpkin in the center."),
  ("Paisley Pumpkins", "A stack of three ornate pumpkins covered in paisley and floral patterns, with swirling vines and leaves all around."),
  ("Harvest Owl", "A decorative owl perched on a branch of autumn leaves, its feathers made of mandala and lace patterns, a harvest moon behind."),
  ("Pie Mandala", "A top-down circular mandala made of pies, apples, leaves, wheat and acorns radiating out from a lattice-top pie in the center."),
 ],
}

P["christmas"] = {
 "easy": [
  ("Jolly Santa", "A jolly Santa Claus face with a big fluffy beard, round cheeks and a floppy hat."),
  ("Christmas Tree", "A simple Christmas tree with big round ornaments, a star on top and three wrapped presents underneath."),
  ("Friendly Snowman", "A friendly snowman with a carrot nose, top hat, scarf and stick arms waving."),
  ("Reindeer Face", "A cute cartoon reindeer with a big round nose, antlers and a bell collar."),
  ("Gingerbread Friend", "A smiling gingerbread cookie person with icing buttons and a bow tie."),
  ("Stocking Full of Toys", "A big Christmas stocking with a teddy bear, a candy cane and a toy train peeking out the top."),
 ],
 "whimsical": [
  ("Santa's Workshop", "Busy elves building toys in Santa's workshop with conveyor belts, shelves of toys, a toy train and a big list on the wall with no writing on it."),
  ("Sleigh Over Rooftops", "Santa's sleigh and reindeer flying over snowy rooftops and chimneys of a small village under a crescent moon and stars."),
  ("Gingerbread Village", "A village of gingerbread houses with candy roofs, gumdrop paths, lollipop trees and a little gingerbread train."),
  ("Decorating the Tree", "A family with kids and a dog decorating a Christmas tree in a living room with a fireplace, stockings and a cat batting an ornament."),
  ("Penguin Sledding Party", "Penguins in scarves and hats sledding down a snowy hill past an igloo with strings of lights."),
  ("North Pole Train", "An old-fashioned steam locomotive with a cowcatcher, a big headlamp and a wreath on the front, pulling open cars piled with wrapped presents and waving elves, chugging through snowy pine mountains toward a North Pole station. The locomotive is an ordinary machine with no face, no eyes and no mouth."),
 ],
 "realistic": [
  ("Reindeer in Snow", "A realistic reindeer with large antlers standing in a snowy pine forest, detailed fur and snow-laden branches."),
  ("Cabin at Christmas", "A log cabin in snowy woods with smoke from the chimney, a wreath on the door, a decorated pine tree outside and snowshoes by the porch."),
  ("Cardinal on Holly", "A realistic northern cardinal perched on a holly branch with berries and pine needles dusted with snow."),
  ("Fireplace Mantel", "A realistic stone fireplace with a garland, stockings, candles and a clock on the mantel, a decorated tree and an armchair beside it."),
  ("Horse-Drawn Sleigh", "Two draft horses pulling a sleigh with bells through a snowy country lane lined with fences and evergreen trees."),
  ("Nutcracker and Ornaments", "A realistic still life of a wooden nutcracker soldier, glass ornaments, pinecones, a candle lantern and ribbon on a table."),
 ],
 "intricate": [
  ("Ornament Mandala", "A large round Christmas ornament filled with snowflake and mandala patterns, hanging from a pine branch with smaller patterned ornaments."),
  ("Patterned Christmas Tree", "A Christmas tree shape built entirely from swirls, stars, snowflakes, ornaments and paisley patterns with a detailed star on top."),
  ("Folk Art Reindeer", "A Scandinavian folk art reindeer whose body is filled with floral and geometric patterns, surrounded by stars and snowflakes."),
  ("Wreath of Everything", "A lush Christmas wreath packed with holly, pinecones, bells, candy canes, oranges, ribbons and tiny ornaments, with a big bow."),
  ("Snowflake Lace", "A page of large ornate snowflakes, each with a different lace-like symmetrical design, with small stars between."),
  ("Gingerbread Mansion", "A grand ornate gingerbread mansion covered in detailed icing scrollwork, candy tiles, peppermint columns and patterned candy trees."),
 ],
}

P["halloween"] = {
 "easy": [
  ("Happy Jack-o'-Lantern", "A big smiling jack-o'-lantern pumpkin with triangle eyes and a toothy grin."),
  ("Friendly Ghost", "A cute round friendly ghost waving, with a tiny bow tie."),
  ("Black Cat on a Pumpkin", "A cartoon cat with a curled tail sitting on top of a pumpkin."),
  ("Little Bat", "A chubby smiling bat with wide wings and tiny fangs under a crescent moon."),
  ("Candy Bucket", "A pumpkin-shaped trick-or-treat bucket overflowing with lollipops and wrapped candies."),
  ("Witch Hat and Broom", "A big pointy witch hat with a buckle next to a broomstick and a small spider on a thread."),
 ],
 "whimsical": [
  ("Haunted House Hill", "A crooked haunted house on a hill with friendly ghosts in the windows, bats, a twisted tree, a full moon and a pumpkin-lined path."),
  ("Trick-or-Treat Street", "Kids in costumes (astronaut, dinosaur, pirate, fairy) trick-or-treating on a decorated neighborhood street with jack-o'-lanterns."),
  ("Witch's Potion Kitchen", "A cheerful young witch stirring a bubbling cauldron in a kitchen full of potion bottles, a cat, a toad and floating spoons."),
  ("Monster Dance Party", "Goofy friendly monsters, a mummy and a skeleton dancing at a party with a pumpkin disco ball and streamers."),
  ("Pumpkin Carving Night", "A family carving pumpkins at a table covered in newspaper with silly finished jack-o'-lanterns lined up and a dog wearing a costume."),
  ("Ghost Train", "A spooky-cute ghost train ride with bats, cobwebs, friendly skeleton conductor and pumpkins along the tracks."),
 ],
 "realistic": [
  ("Raven on a Skull", "A realistic raven perched on a human skull resting on old books with a candle and dried leaves."),
  ("Great Horned Owl", "A realistic great horned owl on a gnarled bare branch in front of a large full moon, with detailed feathers."),
  ("Old Victorian Mansion", "A detailed realistic Victorian mansion with turrets, an iron gate, bare trees and a cobblestone path at night with a moon."),
  ("Pumpkin Patch at Dusk", "A realistic field of pumpkins on tangled vines with a wooden wagon, corn stalks and a farmhouse in the distance."),
  ("Black Cat Portrait", "A realistic black cat drawn in outline sitting on a windowsill beside carved pumpkins, candles and autumn branches."),
  ("Bats Over the Graveyard", "A realistic old graveyard with weathered blank headstones, a stone angel, an iron fence, a dead tree and bats in the sky."),
 ],
 "intricate": [
  ("Sugar Skull", "An ornate decorated sugar skull covered in flowers, hearts, swirls and dot patterns, framed by marigolds and candles."),
  ("Patterned Pumpkin Stack", "A tower of jack-o'-lanterns each carved with a different expression and covered in swirl, web and star patterns, with vines and bats."),
  ("Spiderweb Mandala", "A large circular spiderweb mandala with a decorated spider in the center and patterned sections between the strands."),
  ("Witch's Shelf", "A tall cabinet of curiosities packed with potion bottles, crystals, mushrooms, books, candles, keys and a cat, each object patterned."),
  ("Haunted Tree", "A sprawling twisted tree whose bark is made of swirls and whose branches hold lanterns, owls, bats and patterned pumpkins."),
  ("Moth and Moon", "A large ornate moth with patterned wings beneath moon phases, surrounded by stars, crystals and night-blooming flowers."),
 ],
}

P["easter"] = {
 "easy": [
  ("Bunny with a Carrot", "A cute chubby bunny with long ears holding a big carrot."),
  ("Big Easter Egg", "One giant Easter egg with wide stripes, zigzags and big dots to color."),
  ("Chick in a Shell", "A baby chick popping out of a cracked eggshell with tiny wings up."),
  ("Easter Basket", "A basket with a big bow filled with five decorated eggs."),
  ("Smiling Tulips", "Three large tulips with smiling faces and big leaves, and a butterfly."),
  ("Little Lamb", "A fluffy cartoon lamb with a flower behind its ear standing on a small hill."),
 ],
 "whimsical": [
  ("Egg Hunt Meadow", "Kids and bunnies on an Easter egg hunt in a flower meadow with eggs hidden behind trees, in a birdhouse and under mushrooms."),
  ("Bunny Egg Factory", "A workshop where bunnies paint Easter eggs on a conveyor belt with paint pots, brushes, ladders and baskets."),
  ("Spring Garden Tea Party", "A rabbit, a duck, a hedgehog and a mouse having a tea party in a spring garden with cakes, a teapot and tulips."),
  ("Rainy Day Ducklings", "A line of ducklings in rain boots splashing through puddles behind their mother with umbrellas, raindrops and a rainbow."),
  ("Bunny Hot Air Balloon", "Bunnies riding an egg-shaped hot air balloon over hills, a windmill and fields of flowers."),
  ("Chick Parade", "A parade of chicks carrying flags and banners with no words, pulling a wagon holding a giant decorated egg through a village."),
 ],
 "realistic": [
  ("Cottontail in Clover", "A realistic cottontail rabbit sitting in tall grass and clover with dandelions, detailed fur."),
  ("Hen and Chicks", "A realistic mother hen with a brood of chicks beside a wooden coop, straw and a feed pail."),
  ("Robin's Nest", "A realistic robin feeding chicks in a nest among apple blossoms on a branch."),
  ("Lambs in the Pasture", "Two realistic lambs with their ewe in a spring pasture with a stone wall, a gate and budding trees."),
  ("Daffodils and Tulips", "A realistic botanical illustration of daffodils, tulips, hyacinths and crocuses growing together with a bumblebee."),
  ("Hummingbird at Blossoms", "A realistic hummingbird hovering at a branch of cherry blossoms with buds and leaves."),
 ],
 "intricate": [
  ("Ornate Egg", "A single huge Easter egg in the style of an ornate decorated egg, divided into bands of flowers, lace, scallops and geometric patterns."),
  ("Floral Hare", "A leaping hare whose body is filled with spring flowers, vines and leaf patterns."),
  ("Egg Mandala", "A circular mandala made of decorated eggs, tulips, butterflies and leaves radiating from a center flower."),
  ("Butterfly Garden", "A dense garden of large patterned butterflies and layered flowers filling the whole page."),
  ("Spring Wreath", "A wreath woven from pussy willow, tulips, daffodils, ferns, eggs and ribbons with a patterned bird in the center."),
  ("Hummingbird Paisley", "Two hummingbirds made of feather patterns facing a large paisley flower, with swirling vines filling the background."),
 ],
}

P["valentines"] = {
 "easy": [
  ("Big Heart Balloons", "Three large heart-shaped balloons on strings tied with a bow."),
  ("Teddy with a Heart", "A teddy bear sitting and hugging a big heart."),
  ("Love Bugs", "Two smiling ladybugs with heart-shaped spots on a leaf."),
  ("Cupcake with a Heart", "A big cupcake with swirled frosting and a heart on top."),
  ("Puppy Love", "A cute puppy holding a heart-shaped envelope in its mouth."),
  ("Owl Friends", "Two round owls sitting side by side on a branch with small hearts above them."),
 ],
 "whimsical": [
  ("Valentine Post Office", "Animal mail carriers (a bear, a bird, a mouse) sorting heart-covered envelopes and parcels in a tiny post office."),
  ("Cupid's Cloud Workshop", "Little cherubs on clouds making heart arrows, painting hearts and loading them onto a tiny airship."),
  ("Candy Shop", "A sweet shop counter with jars of candy hearts, chocolates boxes, lollipops, cakes on stands and a cat shopkeeper."),
  ("Hedgehog Picnic", "Two hedgehogs sharing a picnic with strawberries and a heart-shaped cake under a tree with heart-shaped leaves."),
  ("Penguin Ice Dance", "Two penguins ice skating and tracing a heart on a frozen pond, with snowy trees and lanterns."),
  ("Treehouse of Hearts", "A treehouse with heart-shaped windows, a rope ladder, a mailbox stuffed with cards and birds delivering letters."),
 ],
 "realistic": [
  ("Rose Bouquet", "A realistic bouquet of roses with buds, leaves and thorns tied with a silk ribbon."),
  ("Swans", "Two realistic swans on a lake with their necks forming a heart shape, with reeds and water lilies."),
  ("Lovebirds", "Two realistic lovebird parrots cuddling on a flowering branch."),
  ("Box of Chocolates", "A realistic open heart-shaped box of assorted chocolates beside a single rose, a ribbon and a blank card."),
  ("Hot Air Balloons at Dawn", "Realistic hot air balloons drifting over vineyards and hills at dawn."),
  ("Peonies in a Vase", "A realistic glass vase of peonies and ranunculus on a windowsill with a teacup."),
 ],
 "intricate": [
  ("Heart Mandala", "A large heart filled with layered mandala patterns, lace and tiny flowers, with smaller patterned hearts around it."),
  ("Lace Hearts", "A page of overlapping hearts, each filled with a different lace, floral or geometric pattern."),
  ("Rose Garden Swirl", "A dense swirl of roses, buds, leaves and thorny vines filling the page."),
  ("Paisley Lovebirds", "Two decorative birds facing each other on a flowering branch, their feathers made of paisley and scroll patterns."),
  ("Key to My Heart", "An ornate antique key and heart-shaped padlock with filigree scrollwork, surrounded by roses and ribbons."),
  ("Tree of Hearts", "A tree with swirling branches whose leaves are patterned hearts, with patterned roots and birds."),
 ],
}

P["summer"] = {
 "easy": [
  ("Ice Cream Cone", "A giant three-scoop ice cream cone with a cherry on top."),
  ("Beach Bucket", "A sand bucket and shovel beside a simple sandcastle and a starfish."),
  ("Sunny Sunglasses", "A big smiling sun wearing sunglasses."),
  ("Firework Stars", "Three big simple firework bursts and large stars in the sky."),
  ("Watermelon Slice", "A big slice of watermelon with seeds and a smiling face."),
  ("Sailboat", "A simple sailboat on wavy water with a sun and two seagulls."),
 ],
 "whimsical": [
  ("Fourth of July Parade", "A small-town parade with a marching band, kids on decorated bikes, a float with stars and stripes bunting, and waving crowds."),
  ("Fireworks Over the Lake", "Families on picnic blankets watching fireworks over a lake with boats, a dock and fireflies in jars."),
  ("Backyard Cookout", "A backyard barbecue scene with a smoking kettle grill, a picnic table loaded with corn on the cob, burgers, lemonade and watermelon, string lights, lawn chairs, a cooler, a bird on the fence and a happy dog sneaking a hot dog. No people in the scene."),
  ("Beach Day", "A cheerful beach scene with a big sandcastle with flags, a smiling crab, a bucket and shovel, striped beach umbrellas and towels, a surfboard stuck in the sand, seashells, a lighthouse on the point, sailboats, seagulls and a kite in the sky. No people in the scene."),
  ("Lemonade Stand", "Two kids running a lemonade stand with a pitcher, cups, a blank sign, a bike and a line of animal customers."),
  ("Camping Under Stars", "A family campsite with a tent, campfire with marshmallows, a canoe by a lake, an owl and a starry sky."),
 ],
 "realistic": [
  ("Bald Eagle", "A realistic bald eagle perched on a pine branch with mountains and a lake behind, detailed feathers."),
  ("Lighthouse Coast", "A realistic lighthouse on a rocky coast with crashing waves, a keeper's house, gulls and sailboats."),
  ("Old Glory on the Porch", "A realistic farmhouse porch with an American flag on a pole, rocking chairs, potted geraniums and bunting on the railing."),
  ("Vintage Pickup at the Lake", "A realistic vintage pickup truck parked by a lake with fishing rods, a cooler and a canoe in the bed, pines behind."),
  ("Sea Turtle on the Beach", "A realistic sea turtle crawling on a sandy beach with shells, driftwood and waves."),
  ("Mountain Lake", "A realistic alpine lake with a wooden dock, a rowboat, pine forest and jagged peaks reflected in the water."),
 ],
 "intricate": [
  ("Fireworks Mandala", "A night sky filled with ornate firework bursts made of mandala and starburst patterns above a patterned city skyline."),
  ("Stars and Stripes Paisley", "A waving American flag where the stripes are filled with paisley and floral patterns and the stars are detailed."),
  ("Sunflower Field", "A dense field of large sunflowers with detailed seed spirals, patterned petals and leaves, with bees."),
  ("Seashell Collection", "A page packed with seashells, starfish, sand dollars, coral and sea glass, each with detailed patterns."),
  ("Tropical Paradise", "A lush tropical scene of hibiscus, monstera leaves, palm fronds, a toucan and pineapples filled with patterns."),
  ("Ice Cream Dream", "An elaborate tower of ice cream sundaes, popsicles, cones and candies covered in detailed patterns and sprinkles."),
 ],
}

P["holidays"] = {
 "easy": [
  ("Lucky Shamrock", "A big four-leaf clover next to a pot of gold coins with a rainbow."),
  ("Birthday Cake", "A big two-tier birthday cake with five candles and a balloon on each side."),
  ("Menorah", "A simple Hanukkah menorah with nine candles, with a dreidel and round coins beside it."),
  ("New Year Party Hat", "A party hat, a noisemaker horn and a balloon with confetti and stars."),
  ("Paper Lantern", "A round paper lantern with a tassel and a simple smiling dragon face on it."),
  ("Flowers for Mom", "A big bouquet of five simple daisies tied with a bow and a heart."),
 ],
 "whimsical": [
  ("Leprechaun's Rainbow", "A cheerful leprechaun dancing at the end of a rainbow with a pot of gold, mushrooms, clovers and a little cottage."),
  ("Lunar New Year Dragon Dance", "A festive dragon dance in a street with lanterns, drummers, kids and firecrackers."),
  ("Hanukkah Night", "A family gathered at a table with a lit menorah in the window, playing dreidel, with plates of latkes and donuts and snow falling outside."),
  ("Birthday Party Animals", "Animal friends at a birthday party with a giant cake, balloons, presents, party hats and a piñata."),
  ("Diwali Lights", "A family lighting rows of oil lamps on a decorated doorstep with floral floor patterns, sparklers and sweets."),
  ("New Year's Eve Fireworks", "A city rooftop party with kids and parents in party hats watching fireworks over a clock tower at midnight."),
 ],
 "realistic": [
  ("Irish Countryside", "A realistic Irish countryside scene with a stone cottage, thatched roof, stone walls, sheep and rolling hills."),
  ("Day of the Dead Altar", "A realistic Día de los Muertos altar with marigolds, candles, sugar skulls, bread, papel picado banners and empty picture frames."),
  ("Chinese Dragon", "A realistic detailed Chinese dragon coiling through clouds with scales, whiskers and claws."),
  ("Mardi Gras Mask", "A realistic ornate carnival mask with feathers, beads and ribbons on a table."),
  ("Mother's Day Tea", "A realistic still life of a teapot, teacups, a tiered tray of pastries and a vase of garden roses on a lace tablecloth."),
  ("Dreidels and Candles", "A realistic still life of a menorah with tall candles, wooden dreidels, coins and a braided bread on a table."),
 ],
 "intricate": [
  ("Celtic Knot Clover", "A large shamrock made of interlaced Celtic knotwork inside a circular knotwork border."),
  ("Marigold Skull", "A decorated sugar skull wearing a crown of marigolds and roses with detailed floral and filigree patterns."),
  ("Rangoli Mandala", "A large symmetrical rangoli mandala with lotus petals, peacock feather motifs, paisleys and oil lamps around the edge."),
  ("Lantern Festival", "Dozens of ornate patterned lanterns of different shapes floating up into a night sky with patterned clouds."),
  ("Birthday Bash Doodle", "A dense doodle page of cakes, cupcakes, balloons, presents, candles, stars, party hats and streamers filling every space."),
  ("Mardi Gras Feathers", "An elaborate carnival mask with a towering fan of patterned feathers, jewels, beads and scrollwork."),
 ],
}

P["dinosaurs"] = {
 "easy": [
  ("Baby T. Rex", "A cute baby Tyrannosaurus rex with a big head and tiny arms, smiling."),
  ("Long-Neck Friend", "A cute brontosaurus with a long neck eating leaves from a simple tree."),
  ("Triceratops", "A chubby friendly triceratops with three horns and a big frill."),
  ("Dino Egg Hatching", "A baby dinosaur hatching from a big spotted egg."),
  ("Stegosaurus", "A smiling stegosaurus with big back plates and a spiky tail."),
  ("Flying Pterodactyl", "A friendly pterodactyl flying over a simple volcano."),
 ],
 "whimsical": [
  ("Dino Birthday Party", "Cartoon dinosaurs in party hats at a birthday party with a giant cake, balloons and a volcano blowing confetti."),
  ("Dinosaur School Bus", "Little dinosaurs riding a school bus driven by a T. rex through a prehistoric jungle."),
  ("Dino Soccer Game", "Dinosaurs playing soccer in a field with a triceratops goalie, a pterodactyl referee and cheering fans."),
  ("Dino Beach Vacation", "Dinosaurs at the beach surfing, building sandcastles and sunbathing with a long-neck used as a water slide."),
  ("Dino Construction Crew", "Dinosaurs in hard hats working like construction machines: a long-neck crane, a triceratops bulldozer and a T. rex digger."),
  ("Dino Explorer Camp", "Kids in explorer hats camping among friendly dinosaurs, roasting marshmallows with a baby T. rex."),
 ],
 "realistic": [
  ("Tyrannosaurus Rex", "A realistic Tyrannosaurus rex roaring in a fern jungle with detailed scales, a fallen log and pterosaurs in the sky."),
  ("Triceratops Herd", "A realistic herd of triceratops walking across a plain beside a river with cycads and distant volcanoes."),
  ("Brachiosaurus Giants", "Realistic brachiosaurus feeding from tall conifer trees beside a lake with smaller dinosaurs at their feet."),
  ("Velociraptor Pack", "Three realistic feathered velociraptors running through a rocky desert canyon."),
  ("Stegosaurus at the Stream", "A realistic stegosaurus drinking from a forest stream surrounded by ferns and horsetail plants."),
  ("T. Rex Skeleton", "A realistic mounted Tyrannosaurus rex fossil skeleton in a museum hall with arches and smaller fossil displays."),
 ],
 "intricate": [
  ("Patterned T. Rex", "A Tyrannosaurus rex in profile with its body filled with tribal, scale and swirl patterns among patterned jungle leaves."),
  ("Fossil Mandala", "A circular mandala made of ammonites, trilobites, fern fossils, bones and dinosaur footprints."),
  ("Zentangle Triceratops", "A triceratops head facing forward with an elaborately patterned frill and horns."),
  ("Prehistoric Jungle", "A dense prehistoric jungle with hidden dinosaurs peeking between giant patterned ferns, cycads and flowers."),
  ("Dino Egg Nest", "A nest of dinosaur eggs each decorated with a different detailed pattern, surrounded by patterned leaves and a hatchling."),
  ("Sea Monsters", "A plesiosaur and an ichthyosaur swimming among ammonites and seaweed, all filled with wave and scale patterns."),
 ],
}

P["ocean"] = {
 "easy": [
  ("Smiling Whale", "A big smiling whale spouting water with two bubbles."),
  ("Happy Octopus", "A cute octopus with eight curly arms and a big smile."),
  ("Clownfish Pal", "A round striped cartoon fish with big eyes swimming past one sea plant."),
  ("Sea Turtle", "A cute sea turtle with a big patterned shell and flippers."),
  ("Starfish and Shell", "A smiling starfish next to a big scallop shell and a small crab."),
  ("Jolly Dolphin", "A happy dolphin jumping over a wave."),
 ],
 "whimsical": [
  ("Mermaid Lagoon", "A friendly mermaid sitting on a rock combing her hair with fish friends, a treasure chest, a seahorse and a coral castle."),
  ("Pirate Ship Adventure", "A cartoon pirate ship with animal pirates, a treasure map, a parrot, an island with a palm tree and a friendly sea monster."),
  ("Submarine Explorers", "Kids in a submarine with round windows exploring a reef full of fish, an octopus, a sunken ship and a whale."),
  ("Underwater Band", "Sea creatures playing in a band: an octopus on drums, a crab with maracas, a fish on trumpet and a singing whale."),
  ("Tide Pool Town", "A tiny town in a tide pool with hermit crab houses, snail buses, starfish and anemone gardens."),
  ("Penguin and Seal Iceberg", "Penguins and seals sliding off an iceberg into the sea with orcas and fish below the water line."),
 ],
 "realistic": [
  ("Humpback Whale", "A realistic humpback whale and calf swimming underwater with sun rays, small fish and detailed fins."),
  ("Great White Shark", "A realistic great white shark swimming over a reef with a school of fish."),
  ("Coral Reef", "A realistic coral reef with brain coral, sea fans, anemones, angelfish, a moray eel and a sea turtle."),
  ("Octopus", "A realistic octopus with detailed suckers and textured skin resting on rocks with shells."),
  ("Seahorses", "Two realistic seahorses holding onto sea grass with detailed ridges and small shrimp nearby."),
  ("Orca Pod", "Realistic orcas breaching near a rocky coastline with pine trees and gulls."),
 ],
 "intricate": [
  ("Paisley Whale", "A whale filled with wave, paisley and floral patterns, swimming among patterned bubbles and small fish."),
  ("Seahorse Lace", "An ornate seahorse with lace-like patterns among patterned coral and seaweed."),
  ("Jellyfish Bloom", "A group of jellyfish with intricately patterned bells and long swirling tentacles filling the page."),
  ("Mandala Sea Turtle", "A sea turtle seen from above with a mandala-patterned shell, surrounded by patterned waves and shells."),
  ("Mermaid Tail", "A mermaid seen from behind sitting on a rock, with long flowing patterned hair and an ornate scale-patterned tail, shells and pearls around."),
  ("Reef Doodle", "A dense reef packed with dozens of small patterned fish, corals, shells, starfish and anemones filling every space."),
 ],
}

P["animals"] = {
 "easy": [
  ("Friendly Cow", "A cute cow with big spots standing by a single flower."),
  ("Roly-Poly Pig", "A round smiling pig with a curly tail sitting in a puddle."),
  ("Baby Elephant", "A cute baby elephant with big ears holding a balloon with its trunk."),
  ("Lion Cub", "A cute lion with a big round fluffy mane and a smile."),
  ("Puppy and Ball", "A happy puppy with floppy ears sitting next to a big ball."),
  ("Kitten in a Box", "A kitten peeking out of a cardboard box with a ball of yarn."),
 ],
 "whimsical": [
  ("Busy Barnyard", "A busy farm with a red barn, a farmer on a tractor, cows, pigs, chickens, a sheepdog, a duck pond and an orchard."),
  ("Jungle Jamboree", "A monkey, a toucan, a tiger cub, a sloth and an elephant playing among vines, a waterfall and giant leaves."),
  ("Safari Ride", "Kids on a safari truck ride waving at giraffes, zebras, elephants and a lion family on the savanna."),
  ("Forest Friends School", "An owl teacher with a class of fox, raccoon, deer and bunny students at tree-stump desks in the forest."),
  ("Dogs at the Park", "Lots of different dogs playing at a dog park: fetching, digging, on a seesaw, and a tiny dog chasing a huge dog."),
  ("Cat Cafe", "A cozy cafe full of cats napping on shelves, sitting at tables with cups, and a cat barista behind the counter."),
 ],
 "realistic": [
  ("Red Fox", "A realistic red fox sitting among ferns and birch trees with detailed fur."),
  ("Horse Portrait", "A realistic horse galloping across a pasture with its mane flowing, a fence and hills behind."),
  ("Tiger", "A realistic tiger walking through tall grass and bamboo with detailed stripes outlined."),
  ("Elephant Family", "A realistic elephant mother and calf on the savanna with acacia trees and distant mountains."),
  ("Barn Owl", "A realistic barn owl perched on an old fence post with a wooden barn and wheat field behind."),
  ("Gray Wolf", "A realistic gray wolf standing on a rocky outcrop in a pine forest with mountains behind."),
 ],
 "intricate": [
  ("Mandala Lion", "A lion's face seen from the front with a mane made of flowing mandala, feather and flame patterns."),
  ("Zentangle Elephant", "An elephant in profile decorated with ornate blankets, jewelry and patterns filling its body, with lotus flowers."),
  ("Peacock", "A peacock with a huge fanned tail where every feather eye is a detailed pattern."),
  ("Floral Fox", "A fox curled up asleep, its body filled with flowers, leaves and swirls, in a patterned forest floor."),
  ("Butterfly Wings", "One huge butterfly with wings spread, each wing section filled with a different intricate pattern, with flowers around."),
  ("Owl Totem", "A front-facing owl with large eyes and feathers made of layered scallops, dots and paisley, perched on a patterned branch."),
 ],
}

P["space"] = {
 "easy": [
  ("Rocket Ship", "A big simple rocket ship with a round window and flames, with three stars."),
  ("Friendly Robot", "A boxy smiling robot with antenna, big round eyes and claw hands waving."),
  ("Happy Planet", "A smiling ringed planet with two small stars and a tiny moon."),
  ("Little Astronaut", "A cute astronaut in a round helmet floating and waving."),
  ("Alien in a Saucer", "A friendly round alien with three eyes waving from a simple flying saucer."),
  ("Moon and Stars", "A smiling crescent moon wearing a nightcap with five big stars."),
 ],
 "whimsical": [
  ("Moon Base Party", "Kid astronauts and friendly aliens having a picnic on the moon by a dome base with a rover, a flag with a star and Earth in the sky."),
  ("Robot Workshop", "A workshop where little robots build a giant robot with tools, gears, blueprints and a robot dog."),
  ("Alien Planet Zoo", "A zoo on an alien planet with silly made-up creatures in bubble habitats and a robot zookeeper."),
  ("Space Race", "Kids and animals racing rocket cars around planets, through an asteroid field and past a finish line of stars."),
  ("Robot Chef Kitchen", "A robot chef with many arms flipping pancakes, juggling eggs and pouring juice in a futuristic kitchen."),
  ("Space Station Sleepover", "Kids floating in sleeping bags inside a space station with a cat in a helmet, snacks floating and a big window of stars."),
 ],
 "realistic": [
  ("Astronaut Spacewalk", "A realistic astronaut on a spacewalk outside a space station with solar panels and Earth below."),
  ("Rocket Launch", "A realistic rocket lifting off from a launch pad with a tower, exhaust clouds and birds flying."),
  ("Mars Rover", "A realistic six-wheeled rover exploring a rocky Martian landscape with dunes and distant mountains."),
  ("The Solar System", "A realistic diagram-like view of the sun and eight planets with rings, moons, an asteroid belt and a comet, no labels."),
  ("Moon Landing", "A realistic lunar lander on the cratered surface of the moon with an astronaut, footprints and Earth rising."),
  ("Explorer Robot", "A realistic boxy exploration robot on tank treads, with a stereo camera head on a tall mast, two gripper arms, antennas and tool racks, parked in a workshop hangar with crates, a workbench and hanging cables. It is a utility machine, not humanoid and not a suit of armor."),
 ],
 "intricate": [
  ("Galaxy Mandala", "A spiral galaxy mandala with planets, stars, moons and comets woven into concentric patterned rings."),
  ("Steampunk Robot", "A steampunk robot made of gears, pipes, rivets, gauges and clockwork, every part detailed."),
  ("Zodiac Wheel", "A circular wheel of constellations and star patterns with sun and moon faces in the center and ornate borders, no letters."),
  ("Astronaut Garden", "An astronaut whose helmet visor is filled with flowers and butterflies, surrounded by patterned planets and stars."),
  ("Rocket Doodle", "A dense doodle page of rockets, satellites, planets, aliens, stars, comets and UFOs filling every space."),
  ("Circuit City", "A futuristic city skyline where buildings are filled with circuit-board patterns, with flying cars and patterned moons."),
 ],
}

P["fantasy"] = {
 "easy": [
  ("Baby Dragon", "A cute chubby baby dragon with tiny wings sitting and smiling."),
  ("Pretty Unicorn", "A cute unicorn with a big mane, a star on its hip and a simple rainbow behind."),
  ("Little Castle", "A simple castle with three towers, flags and a big door."),
  ("Fairy on a Mushroom", "A tiny smiling fairy with big wings sitting on a spotted mushroom."),
  ("Friendly Knight", "A small cartoon knight in armor holding a shield with a star and a wooden sword."),
  ("Magic Wand", "A star-tipped magic wand with ribbons, a crown and sparkles."),
 ],
 "whimsical": [
  ("Dragon's Treasure Cave", "A friendly dragon reading a book on top of a pile of treasure in a cave with a knight friend having tea."),
  ("Unicorn Meadow", "Unicorns playing in a meadow with a rainbow, a waterfall, butterflies and a castle on a far hill."),
  ("Fairy Village", "A village of mushroom houses and acorn cottages with fairies, ladybug taxis, lanterns and tiny bridges."),
  ("Wizard's Tower", "A wizard with a long beard in a tower room full of books, potions, a crystal ball, an owl and floating candles."),
  ("Mermaid and Dragon Tea", "A sea dragon and a mermaid princess sharing tea on a rock by a seaside castle."),
  ("Castle Tournament", "A cheerful castle fair with knights on hobby horses, a jester juggling, banners, a princess and a baby dragon roasting marshmallows."),
 ],
 "realistic": [
  ("Mountain Dragon", "A realistic detailed dragon with scales, horns and spread wings perched on a mountain crag above clouds."),
  ("Forest Unicorn", "A realistic unicorn standing in an ancient forest glade by a stream with ferns and shafts of light shown as outlines."),
  ("Castle on the Cliff", "A realistic medieval castle with towers, battlements and a drawbridge on a cliff above a river valley."),
  ("Griffin", "A realistic griffin with eagle head and wings and lion body standing on a rocky ledge."),
  ("Phoenix Rising", "A realistic phoenix with long flowing tail feathers rising with wings spread."),
  ("Knight and Horse", "A realistic knight in full plate armor on an armored horse holding a lance, with a castle behind."),
 ],
 "intricate": [
  ("Mandala Dragon", "An Eastern-style dragon coiled in a circle with every scale detailed, surrounded by patterned clouds and waves."),
  ("Floral Unicorn", "A unicorn head in profile with a long flowing mane woven with roses, vines, stars and braids."),
  ("Enchanted Tree", "A giant fairy tree with doors, windows, spiral stairs, lanterns, mushrooms and patterned bark and leaves."),
  ("Phoenix Feathers", "A phoenix with an enormous tail of ornate patterned feathers swirling around the page."),
  ("Fairy Wings", "A fairy seen from behind with huge wings patterned like stained glass, sitting among detailed flowers."),
  ("Dragon Eggs", "A nest of dragon eggs, each with different scale, crystal and filigree patterns, guarded by a small curled dragon."),
 ],
}

STYLE_ORDER = ["easy", "whimsical", "realistic", "intricate"]

# Pages made from visitor requests live in requests.json next to this file:
# [{"id": "requests-001", "style": "whimsical", "title": "...", "subject": "..."}]
_REQ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "requests.json")
REQUESTS = json.load(open(_REQ)) if os.path.exists(_REQ) else []
if REQUESTS:
    THEMES.append(("requests", "By Request", "✏️"))

def build():
    pages = []
    for key, name, emoji in THEMES:
        if key not in P:
            continue
        n = 0
        # interleave styles so each theme grid mixes styles
        for i in range(6):
            for st in STYLE_ORDER:
                title, subject = P[key][st][i]
                n += 1
                pages.append({"id": f"{key}-{n:02d}", "theme": key, "style": st, "title": title, "subject": subject})
    for r in REQUESTS:
        pages.append({"id": r["id"], "theme": "requests", "style": r["style"], "title": r["title"], "subject": r["subject"]})
    return pages

def prompt_for(p):
    return f"Black and white coloring book page, portrait orientation. {p['subject']} {STYLES[p['style']]} {TAIL}"

if __name__ == "__main__":
    out = sys.argv[1]
    pages = build()
    assert len({p['id'] for p in pages}) == len(pages)
    for k in P:
        for st in STYLE_ORDER:
            assert len(P[k][st]) == 6, (k, st)
    os.makedirs(out, exist_ok=True)
    cat = {"themes": [{"key": k, "name": n, "emoji": e} for k, n, e in THEMES],
           "pages": [{"id": p["id"], "t": p["theme"], "s": p["style"], "n": p["title"]} for p in pages]}
    json.dump(cat, open(os.path.join(out, "catalog.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    json.dump([{"i": i, "id": p["id"], "prompt": prompt_for(p)} for i, p in enumerate(pages)],
              open(os.path.join(out, "prompts.json"), "w"), ensure_ascii=False, indent=0)
    print(len(pages), "pages")
