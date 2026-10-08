import type { ProductCategory } from "./shipping";

export type Variant = {
  id: number;
  sku: string;
  label: string;
  price: number;
  compare: number | null;
  stock: number | null;
};

export type Product = {
  id: number;
  slug: string;
  name: string;
  kind: "eggs" | "birds";
  /** Hatching eggs, chicks, or adult birds (drives the default shipping methods). */
  category: ProductCategory;
  /** Slugs of the shipping methods this listing can go out by. Farm pickup is always allowed. */
  shipping: string[];
  image: string;
  description: string;
  variants: Variant[];
};

/** Starter listings as imported from the GoDaddy store (category is guessed at seed time). */
export type SeedProduct = Omit<Product, "category" | "shipping">;

export const products: SeedProduct[] = [
  {
    "id": 1,
    "slug": "ayam-cemani",
    "name": "Ayam Cemani Hatching Eggs",
    "kind": "eggs",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/ols/197557907_294110889024507_827696739514423-0002.jpg/:/rs=w:1200,h:1200",
    "description": "Start Your Own Ayam Cemani Flock – Exotic Black Indonesian Ayam Cemani 🐔🥚\nBring unique mystique to your flock with Ayam Cemani hatching eggs—renowned for their striking all-black appearance, from feathers to beaks, combs, and even internal organs. Often referred to as the \"Lamborghini of Chickens,\" these exotic birds are sure to captivate and elevate your homestead.\n\n🦸‍♂️ Why the Hogg's Heaven Ayam Cemani? The Hogg’s Heaven Ayam Cemani has been meticulously raised from multiple import lines since 2018, each year undergoing a stringent selection and culling process. Chuck has been fascinated by these intriguing birds from the very start and enjoys the rewarding challenge of refining the breed.  As a registered breeder with the ACBA, it has been our dedication to breed to the Standard of Perfection (SOP) and maintain the integrity, genetic purity and overall quality.  Our Ayam Cemani hens are calm, personable, and highly effective foragers. Known for their curiosity and intelligence, these chickens are also celebrated by many customers for their impressive rodent-catching skills! Their egg-laying frequency—around 80-100 eggs annually of small to medium-sized white to cream-colored eggs—helps maintain their rarity and exclusivity.\n\n🐣 What’s Special About Our Hatching Eggs?\nFertile & Fresh: Our eggs are collected daily and shipped as fresh as they come. You’ll receive a mix of sizes and egg colors from our carefully selected flock.\nNPIP Certified & Disease-Free: Buy with confidence from a responsible, certified breeder. We take biosecurity seriously to ensure the health of your",
    "variants": [
      {
        "id": 143,
        "sku": "AC-1-DZN",
        "label": "1 Dozen (12) Hatching Eggs",
        "price": 50.0,
        "compare": 75.0,
        "stock": null
      }
    ]
  },
  {
    "id": 2,
    "slug": "bresse",
    "name": "Bresse",
    "kind": "birds",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/ols/288864658_539361837832743_362511309714670-0001.jpg/:/rs=w:1200,h:1200",
    "description": "At Hogg’s Heaven, we have a family of 5, and the Bresse has become a staple.  Not only does it produce 240+ eggs a year, but it is among the best chicken meat you’ve ever had.  These birds are just amazing! Large cream, whitish cream eggs. The roosters do like their girls so we actually keep a higher ratio of hen to roo with them without any problem! They prove themselves why they are becoming the most sought after dual purpose bird.",
    "variants": [
      {
        "id": 8,
        "sku": "BRS-DAY-OLD",
        "label": "Day Old Chick Straight Run",
        "price": 15.0,
        "compare": null,
        "stock": null
      },
      {
        "id": 130,
        "sku": "BRS-OFF-HT",
        "label": "Off Heat Juvenile Cockerel/Pullet",
        "price": 20.0,
        "compare": null,
        "stock": null
      },
      {
        "id": 131,
        "sku": "BRS-4-MNT",
        "label": "4+ Month Cockerel/Pullet",
        "price": 40.0,
        "compare": null,
        "stock": null
      }
    ]
  },
  {
    "id": 3,
    "slug": "chocolate-orpington",
    "name": "Chocolate Orpington",
    "kind": "birds",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/ols/chocoorp.png/:/rs=w:1200,h:1200",
    "description": "Chocolate Orpington",
    "variants": [
      {
        "id": 3,
        "sku": "CO",
        "label": "Standard",
        "price": 50.0,
        "compare": null,
        "stock": 0
      }
    ]
  },
  {
    "id": 4,
    "slug": "french-wheaten-maran",
    "name": "French Wheaten Maran (BBS)",
    "kind": "birds",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/ols/294423353_552601619842098_5233092623112322884_.jpg/:/rs=w:1200,h:1200",
    "description": "The French Wheaten Maran is a great dark brown egg layer.  Instead of a dark black hen, you’ll see whites, tans, and browns carried in these girls, with feathered shanks. This breed is one of our very first we began breeding, and we won’t stop! They are the kindest, sweetest breed, and just gorgeous too!  In their tail feathers is where you will see either black (regular), gray (blue) or all white (splash).  They are excellent egg layers too once they get going!",
    "variants": [
      {
        "id": 18,
        "sku": "FRN-WHT-MRN-DAY-OLD",
        "label": "Day Old Chick Straight Run",
        "price": 15.0,
        "compare": null,
        "stock": 6
      }
    ]
  },
  {
    "id": 7,
    "slug": "gold-deathlayer",
    "name": "Gold Deathlayer",
    "kind": "birds",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/ols/280971440_514663030302624_774473702224346-0001.jpg/:/rs=w:1200,h:1200",
    "description": "Purchased directly from Greenfire Farms and raised here since 2021.  These birds are the best scavengers we have.  They lay large beautiful white eggs. They rarely go inside their shelter, they very much prefer to eat, sleep, and play outside!",
    "variants": [
      {
        "id": 32,
        "sku": "GD-SR",
        "label": "Day Old Chick Straight Run",
        "price": 20.0,
        "compare": null,
        "stock": 6
      }
    ]
  },
  {
    "id": 8,
    "slug": "belgian-liege-fighter",
    "name": "Belgian Liege Fighter",
    "kind": "birds",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/ols/liegefighter.jpg/:/rs=w:1200,h:1200",
    "description": "The Liege Fighter, or Luikse Vechter is a kind of Belgian game bird that originated in Western Europe. Belgian and Asian game fowl were selectively bred together to ultimately create this one of a kind breed.  The Liege Fighter variety at Hogg’s Heaven comes from Greenfire Farms, we have a Birchen Roo and Hen, and a Blue/Pumpkin Roo and white Hen in our breeding stock",
    "variants": [
      {
        "id": 8,
        "sku": "BLG",
        "label": "Standard",
        "price": 15.0,
        "compare": null,
        "stock": 0
      }
    ]
  },
  {
    "id": 9,
    "slug": "jubilee-orpington",
    "name": "Jubilee Orpington",
    "kind": "birds",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/ols/287318573_533974081704852_4541734436829008503_.jpg/:/rs=w:1200,h:1200",
    "description": "Hogg’s Heaven Jubilee Orpington’s are currently a work in progress; we’ve made our selection roo and hen, and have been test breeding this pair.",
    "variants": [
      {
        "id": 9,
        "sku": "JO",
        "label": "Standard",
        "price": 60.0,
        "compare": null,
        "stock": 0
      }
    ]
  },
  {
    "id": 10,
    "slug": "lavender-orpington",
    "name": "Lavender Orpington",
    "kind": "birds",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/ols/169517500_256284016140528_8593273722204881666_.jpg/:/rs=w:1200,h:1200",
    "description": "The roots of the Hogg’s Heaven Lavender Orpingtons stem from the English side.  Our primary breeding group are rather plump.  The HH Orpingtons are broad across the back and have a more rounded shape than other breeds.",
    "variants": [
      {
        "id": 10,
        "sku": "LO",
        "label": "Standard",
        "price": 60.0,
        "compare": null,
        "stock": 0
      }
    ]
  },
  {
    "id": 11,
    "slug": "pita-pinta-black-mottled",
    "name": "Pita Pinta - Black Mottled",
    "kind": "birds",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/ols/158390152_236070348161895_6314097838866259521_.jpg/:/rs=w:1200,h:1200",
    "description": "The Black Mottled Pita Pinta at Hogg’s Heaven originated in Spain.  Our stock stems from Greenfire Farms, and have been worked on over the 2021/2022 season.  This breed is very often compared to Orpingtons, due to their calm demeanor, and large eggs.  They are excellent for families, due to being sweet and calm as well.  They are a standard size bird, roosters get pretty large.",
    "variants": [
      {
        "id": 52,
        "sku": "PPB-SR",
        "label": "Day Old Chick Straight Run",
        "price": 15.0,
        "compare": null,
        "stock": null
      }
    ]
  },
  {
    "id": 12,
    "slug": "pita-pinta-red-mottled",
    "name": "Pita Pinta - Red Mottled",
    "kind": "birds",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/ols/284488911_526663819102545_6396429129667067424_.jpg/:/rs=w:1200,h:1200",
    "description": "The Red Mottled Pita Pinta at Hogg’s Heaven originated in Spain.  Our stock stems from Greenfire Farms, and have been worked on over the 2022 season.  This will be our second season with them in 2023. They are gorgeous, calm, standard size birds. Roosters are taller/larger.  They lay large cream-darker cream-pinkish cream eggs.",
    "variants": [
      {
        "id": 12,
        "sku": "PPR",
        "label": "Standard",
        "price": 15.0,
        "compare": null,
        "stock": 1
      }
    ]
  },
  {
    "id": 13,
    "slug": "schijndelaar",
    "name": "Schijndelaar",
    "kind": "birds",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/ols/165296434_248275323608064_7370699669078106801_.jpg/:/rs=w:1200,h:1200",
    "description": "The Schijndelaar was created by local veterinarian Ruud Kaasenbrood in the late 20th Century by crossing Araucanas (for their blue egg gene), Sumatras (for their long bodies), Dutch crested fowls (for their crests), Brabant fowl (for who know what) and Leghorns (for their legendary egg production). Our breeding stock came from Greenfire Farms.",
    "variants": [
      {
        "id": 62,
        "sku": "SJ-SR",
        "label": "Day Old Chick Straight Run",
        "price": 30.0,
        "compare": null,
        "stock": 0
      }
    ]
  },
  {
    "id": 14,
    "slug": "self-blue-lavender-ameraucana",
    "name": "Self-Blue (Lavender) Ameraucana",
    "kind": "birds",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/ols/158411232_236071278161802_5084836437330496526_.jpg/:/rs=w:1200,h:1200",
    "description": "Also known as Lavender Ameraucanas, these birds are a study in pastels with their pearly blue-grey plumage and light blue eggs. We're obsessed with their muffs and beards, too, and their pea combs and lack of wattles help protect against frostbite in cold areas.  Our breeding set came from champion breeders Twin Brothers.",
    "variants": [
      {
        "id": 14,
        "sku": "SBA",
        "label": "Standard",
        "price": 20.0,
        "compare": null,
        "stock": 0
      }
    ]
  },
  {
    "id": 15,
    "slug": "white-legbar",
    "name": "White Legbar",
    "kind": "birds",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/ols/292636002_552589936509933_722277534204296-0001.jpg/:/rs=w:1200,h:1200",
    "description": "The White Legbar came from one of the Cream Legbar Club members,  they worked on this breed crossing their lines from Greenfire Farms, which the White Legbars are most likely from their B line.  This breed lays very well, and eggs tend to be on the baby blue side.  Hens are medium size.  They are a calm, sweet breed. They are lighter in weight which will allow them to flutter up quicker from predators if free ranging.  Excellent layers.",
    "variants": [
      {
        "id": 126,
        "sku": "WLB-DAY-OLD",
        "label": "6 Day Old Chicks Straight Run",
        "price": 72.0,
        "compare": null,
        "stock": 1
      },
      {
        "id": 127,
        "sku": "WLB-12-DAY",
        "label": "12 Day Old Chicks Straight Run",
        "price": 140.0,
        "compare": 144.0,
        "stock": 1
      },
      {
        "id": 128,
        "sku": "WLB-18-DAY",
        "label": "18 Day Old Chicks Straight Run",
        "price": 210.0,
        "compare": 216.0,
        "stock": 1
      }
    ]
  },
  {
    "id": 16,
    "slug": "black-copper-maran",
    "name": "Black Copper Maran",
    "kind": "birds",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/ols/E176331B-062C-44AA-B499-984EAC02ED44.jpeg/:/rs=w:1200,h:1200",
    "description": "The Black Copper Marans on our farm are a group from three different lines.  One line comes from a fellow breeder whom has won awards with the brother of our roo! We were excited to bring her line onto our farm to continue to improve this breed.  We also have some direct from Greenfire Farms. Then last we acquired some from another breeder who has worked on her line for several years as well.  These three lines should provide high quality birds!",
    "variants": [
      {
        "id": 77,
        "sku": "BCM-DAY-OLD",
        "label": "Day Old Chick Straight Run",
        "price": 15.0,
        "compare": null,
        "stock": 0
      }
    ]
  },
  {
    "id": 17,
    "slug": "pita-pinta-black-mottled-pt-pnt-blc-mtt",
    "name": "Speckled Sussex",
    "kind": "birds",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/ols/1A64758C-84A8-4820-BD1F-BFE77DF9CA2A.jpeg/:/rs=w:1200,h:1200",
    "description": "Our Speckled Sussex look amazing! We acquired them from a reputable breeder whom has worked hard on creating high quality show birds! This is our first year offering this breed and we look forward to continue improving them and building on what she started. This breed is a standard size, with cream—pinkish cream colored large eggs.  They are known to be calm as well.",
    "variants": [
      {
        "id": 17,
        "sku": "SPSX",
        "label": "Standard",
        "price": 15.0,
        "compare": null,
        "stock": 1
      }
    ]
  },
  {
    "id": 18,
    "slug": "schijndelaar-sch",
    "name": "MARSBAR",
    "kind": "birds",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/ols/D9794958-D2C5-40F9-AB96-548DE3FC8AB7.jpeg/:/rs=w:1200,h:1200",
    "description": "Start Your Own MarsBars Flock – The Calm, Sweet, and Camouflaged Chicks! 🐣🥚\nLooking for adorable, unique chicks that grow into calm, sweet, and productive birds? Our MarsBars Chicks are the perfect addition to your flock! These first-generation crosses combine the best traits of Frosted White Legbars and French Wheaten Marans, making them a delightful choice for homesteaders and poultry enthusiasts.\n\n🦸‍♂️ Why MarsBars Chicks?\nMarsBars Chicks are the result of crossing our Frosted White Legbars (known for their blue eggs) with French Wheaten Marans (famous for their dark brown eggs). These chicks inherit the best qualities from both breeds: a calm, sweet temperament and strong laying abilities. As they grow, they'll produce beautiful olive eggs—a perfect addition to any egg basket!\n\n🐣 What’s Special About Our MarsBars Chicks?\nAdorable & Friendly: MarsBars Chicks are as sweet as they come. With their calm personalities and easy-to-handle nature, they’re perfect for families and backyard flocks. \nIncredible Camouflage: As they mature, MarsBars grow into birds with fascinating color patterns that allow them to blend seamlessly into their surroundings. Their color variations, such as the Calico pattern, make them natural camouflaged birds. You'll be amazed at how they sometimes seem to disappear until they come running toward you for food!\nFertility & Fresh Stock: Our MarsBars stock comes from a carefully planned cross between our Frosted White Legbars (sweet, blue egg layers) and French Wheaten Marans (larger, dark egg layers). The result is a breed that is not only productive ",
    "variants": [
      {
        "id": 83,
        "sku": "SJ1",
        "label": "Day Old Chick Straight Run",
        "price": 12.0,
        "compare": null,
        "stock": 1
      }
    ]
  },
  {
    "id": 23,
    "slug": "white-bresse-hatching-eggs",
    "name": "White Bresse Hatching Eggs",
    "kind": "eggs",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/fb_484861836616077_1536x2048.jpg/:/rs=w:1200,h:1200",
    "description": "Start Your Own American Bresse Flock – The \"Wagyu of Chickens\" 🐔🥚\nLooking to add some gourmet-quality poultry to your homestead or backyard flock? Our White American Bresse hatching eggs are your ticket to raising one of the most flavorful chicken breeds in the world!\n\n🦸‍♂️ Why American Bresse?\nThese chickens aren’t just great for their taste – they’re easy-going, great layers, and perfect for both meat and eggs! Their mild temperament makes them a pleasure to raise, while their natural foraging ability and resilience ensure they thrive on your homestead. Plus, these chickens are a prized delicacy, often called the \"Wagyu of Chicken,\" known for their tender, richly marbled meat – a true farm-to-table experience.\n🐣 What’s Special About Our Hatching Eggs?\nFertile & Fresh: Our eggs are collected daily and shipped as fresh as they come. You’ll receive a mix of sizes and egg colors from our carefully selected flock.\nNPIP Certified & Disease-Free: Buy with confidence from a responsible, certified breeder. We take biosecurity seriously to ensure the health of your future flock.\nSelective Breeding for Performance: We acquired 2 lines of White American Bresse in 2021, one directly from Greenfire Farms (2019 import), and another from a breeder who worked with the original 2017 imported line. After selectively crossing these lines, we’ve spent 3 years perfecting their quality. Our breeding program focuses on fast growth, excellent egg production, and a calm yet alert nature, making them a fantastic choice for homesteaders and small farms.\nA Range of Sizes & Colors: Due to genetic dive",
    "variants": [
      {
        "id": 95,
        "sku": "WB-HEGGS-12",
        "label": "1 Dozen (12) Hatching Eggs",
        "price": 30.0,
        "compare": 65.0,
        "stock": null
      }
    ]
  },
  {
    "id": 35,
    "slug": "black-copper-maran-blc-cpp-mrn",
    "name": "Black Copper Maran Hatching Eggs",
    "kind": "eggs",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/ols/CCE494A0-0DEC-45BD-84ED-8F4A3D59EFBF.jpeg/:/rs=w:1200,h:1200",
    "description": "Start Your Own Black Copper Maran Flock – Rich, Dark Chocolate Eggs! 🐔🥚\nLooking for a beautiful, high-quality breed that produces some of the darkest eggs in the chicken world? Our Black Copper Marans hatching eggs are perfect for anyone wanting to raise stunning, hardy birds that are as impressive in the coop as they are in the egg basket!\n🦸‍♂️ Why Black Copper Marans?\nBlack Copper Marans are renowned for their exceptional egg color, producing rich, dark chocolate brown eggs that are sure to impress your friends and family. But these birds aren’t just prized for their eggs – they are also hardy, calm, and excellent foragers, making them an ideal addition to any homestead or backyard flock. Their striking black and copper plumage makes them a beautiful breed to raise, while their friendly yet independent nature makes them a joy to keep.\n🐣 What’s Special About Our Hatching Eggs?\nFertile & Fresh: Our eggs are collected daily and shipped fresh, ensuring the best start for your hatch. Expect a mix of egg sizes and shades, with beautiful dark brown shells, characteristic of the Black Copper Maran breed.\nNPIP Certified & Disease-Free: Buy with confidence from a certified breeder. We take biosecurity seriously, ensuring the health of your future flock.\nSelective Breeding for Quality: Our Black Copper Marans come from three excellent lines. One of our lines is from a fellow breeder who has won awards with the brother of our roo! We were thrilled to bring this exceptional line onto our farm to continue improving the breed. We also have birds directly from Greenfire Farms, known for ",
    "variants": [
      {
        "id": 120,
        "sku": "BCM-HEGGS-6",
        "label": "1/2 Dozen (6) Hatching Eggs",
        "price": 30.0,
        "compare": null,
        "stock": null
      },
      {
        "id": 121,
        "sku": "BCM-HEGGS-12",
        "label": "1 Dozen (12) Hatching Eggs",
        "price": 55.0,
        "compare": null,
        "stock": null
      }
    ]
  },
  {
    "id": 37,
    "slug": "gold-deathlayer-gld-dth",
    "name": "Gold/Lemon Deathlayer Hatching Eggs",
    "kind": "eggs",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/fb_244455430656720_720x960.jpg/:/rs=w:1200,h:1200",
    "description": "Start Your Own Gold Deathlayer Flock – The “Royalty” of Poultry! 🐔🥚\nLooking for a hardy, beautiful, and productive addition to your flock? Our Gold Deathlayer hatching eggs are just what you need! These amazing birds are not only known for their striking appearance but also for their exceptional egg-laying abilities.  We have one rare Lemon Deathlayer hen in our Deathlayer pen, it is possible for you to receive Lemon Deathlayer eggs. If you want a breed that will thrive outside, providing you with a steady supply of large white eggs, this is the one for you!\n\n🦸‍♂️ Why Gold Deathlayers?\nThe Gold Deathlayer is the chicken breed that seems to have it all: a captivating name, a royal look, and a rich history dating back over 400 years in Germany. Known for being one of the most prolific layers, these hens will keep your egg basket full with their consistent laying habits. They’re not just beautiful to look at – they’re highly independent and one of the best scavengers in the poultry world. If you want chickens that prefer the outdoors and love to forage, the Gold Deathlayer is an ideal choice for your homestead.\n\n🐣 What’s Special About Our Hatching Eggs?\nFertile & Fresh: We gather eggs daily from our Gold Deathlayer hens, ensuring you receive only the freshest eggs for hatching. The eggs are medium-sized, beautifully white, and perfect for starting your own flock.\nNPIP Certified & Disease-Free: Buy with confidence from a certified breeder. We prioritize the health and well-being of our birds.\nRaised for Robustness: These birds were purchased directly from Greenfire Farms and ha",
    "variants": [
      {
        "id": 110,
        "sku": "GDEH12",
        "label": "1 Dozen Hatching Eggs",
        "price": 60.0,
        "compare": null,
        "stock": null
      },
      {
        "id": 142,
        "sku": "GLD-DTH-EG12-1-2",
        "label": "1/2 Dozen (6) Hatching Eggs",
        "price": 35.0,
        "compare": null,
        "stock": null
      }
    ]
  },
  {
    "id": 38,
    "slug": "white-bresse-hatching-eggs-wht-brs-htc-ggs",
    "name": "Fibro Egger/Easter Egger Hatching Eggs",
    "kind": "eggs",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/Hogg%27s%20Heaven%20Farm.png",
    "description": "One dozen (12 eggs)  of Fibro Egger/Easter Egger Hatching Eggs\n\nThese eggs are laid by hens of various ages of Black Copper Marans, Welsummer, and Ayam Cemani with Self Blue Ameraucana Roosters, and thus come in a RANGE OF VARIOUS SIZES AND COLOR SHADES. Like many other breeds, egg sizes increase by the age of the hen. The older the hen the larger the egg. The egg shell color also tends to get lighter by age. In addition to genetic diversity, it is important to have a range of different ages in your flock, otherwise they all could go into molting and stop laying at the same time. We maintain multiple breeding pens, and egg colors will vary.  Egg size (or color shade) ranges that are due to age difference have absolutely NO EFFECTS on the size of the birds when they grow up or size of the eggs they'll be laying as the genetic makeup of a chicken remains the same throughout its life and does not change with age.\n\nEggs are gathered daily and the freshest eggs are sent after payment is made, shipping Monday thru Wednesday via USPS Priority Flat Rate, due to postal restrictions.  We do not like shipping after Wednesday because of delivery delays through the weekend.\n\nWe guarantee that you get at least 50% of the listed quantity hatch or we will send you a replacement for the difference (up to 50% of the original listed quantity).  We require photos or videos of the unhatched eggs, cracked open, showing our eggs, showing how many hatched and didn't hatch and pay a $20 flat rate shipping fee (regardless of the quantity).  There is risk involved with shipping eggs that buyers assum",
    "variants": [
      {
        "id": 112,
        "sku": "FE-HEGGS12",
        "label": "1 Dozen (12) Hatching Eggs",
        "price": 65.0,
        "compare": null,
        "stock": null
      },
      {
        "id": 122,
        "sku": "FE-HTC-GGS-1-2",
        "label": "1/2 Dozen (6) Hatching Eggs",
        "price": 30.0,
        "compare": null,
        "stock": null
      }
    ]
  },
  {
    "id": 40,
    "slug": "pita-pinta-black-mottled-bf43221d-6339-4ac8-b1b0-78fb6e43c608",
    "name": "Pita Pinta - Black Mottled Hatching Eggs",
    "kind": "eggs",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/fb_487541279681466_1536x2048.jpg/:/rs=w:1200,h:1200",
    "description": "Start Your Own Black and White Pita Pinta Flock – The Calm, Sweet, and Productive Bird! 🐔🥚\nLooking for a breed that's not only stunning to look at but also incredibly sweet and productive? Our Black and White Pita Pinta hatching eggs are the perfect choice! With a calm demeanor, large eggs, and great temperament, these birds will be a wonderful addition to your homestead or backyard flock.\n\n🦸‍♂️ Why Black and White Pita Pinta?\nOriginating from Spain, the Black and White Pita Pinta is a breed that combines beauty, calmness, and productivity. Often compared to Orpingtons due to their friendly nature and impressive egg-laying abilities, these birds are known for their large eggs and sweet disposition. Whether you have a small family farm or are just getting started with poultry, the Pita Pinta makes a great choice for both beginners and experienced poultry keepers alike.\n\n🐣 What’s Special About Our Hatching Eggs?\nFertile & Fresh: We gather eggs daily from our Black and White Pita Pinta hens to ensure you receive the freshest eggs possible for hatching. These large eggs will give you a great start to raising this beautiful and calm breed. \nNPIP Certified & Disease-Free: Buy with confidence from a certified breeder. We prioritize the health and well-being of our birds.\nStock from Greenfire Farms: Our Pita Pinta stock stems directly from Greenfire Farms and has been carefully worked on over the 2021/2022 season to ensure top-quality birds. We have spent time focusing on breeding for calmness and egg production, resulting in birds that are perfect for families and backyard flocks.",
    "variants": [
      {
        "id": 124,
        "sku": "PT-PNT-BLC-MTT-1-DZN",
        "label": "1 Dozen (12) Hatching Eggs",
        "price": 65.0,
        "compare": null,
        "stock": null
      },
      {
        "id": 125,
        "sku": "PT-PNT-BLC-MTT-1-2",
        "label": "1/2 Dozen (6) Hatching Eggs",
        "price": 35.0,
        "compare": null,
        "stock": null
      }
    ]
  },
  {
    "id": 44,
    "slug": "black-bresse-hatching-eggs",
    "name": "Black Bresse Hatching Eggs",
    "kind": "eggs",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/ols/blackbresse1.jpg/:/rs=w:1200,h:1200",
    "description": "Start Your Own American Black Bresse Flock – The \"Wagyu of Chickens\" 🐔🥚\nLooking to add some gourmet-quality poultry to your homestead or backyard flock? Our Black American Bresse hatching eggs are your ticket to raising one of the most flavorful and unique chicken breeds in the world!\n\n🦸‍♂️ Why American Black Bresse?\nThese chickens aren’t just great for their taste – they’re easy-going, great layers, and perfect for both meat and eggs! Their mild temperament makes them a pleasure to raise, while their natural foraging ability and resilience ensure they thrive on your homestead. Plus, these chickens are a prized delicacy, often called the \"Wagyu of Chicken,\" known for their tender, richly marbled meat – a true farm-to-table experience.  Similar to our White Bresse, the Black Bresse are slightly smaller than White Bresse, but lay 240+ eggs per year.\n\n🐣 What’s Special About Our Hatching Eggs?\nFertile & Fresh: Our eggs are collected daily and shipped as fresh as they come. You’ll receive a mix of sizes and egg colors from our carefully selected flock.\nNPIP Certified & Disease-Free: Buy with confidence from a responsible, certified breeder. We take biosecurity seriously to ensure the health of your future flock.\nSelective Breeding for Performance: We acquired 3 lines of Black American Bresse in 2022. These lines had heavy leakage, so we focused on selectively breeding to eliminate the leakage and focus on pure black coloration. While most of the chicks from this pen will be solid black, there may also be some silver leakage. Over the past 2 years, we've carefully bred and refine",
    "variants": [
      {
        "id": 137,
        "sku": "BB-HEGGS-12",
        "label": "1 Dozen (12) Hatching Eggs",
        "price": 35.0,
        "compare": 50.0,
        "stock": 5
      }
    ]
  },
  {
    "id": 45,
    "slug": "french-wheaten-maran-bbs",
    "name": "French Wheaten Maran Hatching Eggs (BBS)",
    "kind": "eggs",
    "image": "https://img1.wsimg.com/isteam/ip/8c59a9b8-be4d-43d3-99a6-a9c6c6896258/fb_236075438161386_1360x2048.jpg/:/rs=w:1200,h:1200",
    "description": "Start Your Own French Wheaten Marans Flock – Mildly Dark Eggs🐔🥚\nAdd depth to your flock with French Wheaten Marans hatching eggs – known for their rich, darker tan colored eggs and stunning feather patterns. These birds combine classic beauty with steady performance, making them a staple for any serious poultry keeper.\n\n🦸‍♂️ Why French Wheaten Marans?\nThese hens are calm, gentle, and visually striking. With feathers in soft wheaten tones – tans, whites, and browns – and feathered shanks, they stand out in any flock. Tail feather color reveals their genetic variation: black (regular), gray (blue), or white (splash). This breed has been with us since the beginning and remains a cornerstone of our breeding program due to their consistent temperament and beauty. Once they reach maturity, their egg production is strong and steady, delivering deep brown eggs prized by collectors and chefs alike.\n\n🐣 What’s Special About Our Hatching Eggs?\nFertile & Fresh: Our eggs are collected daily and shipped as fresh as they come. You’ll receive a mix of sizes and egg colors from our carefully selected flock.\nNPIP Certified & Disease-Free: Buy with confidence from a responsible, certified breeder. We take biosecurity seriously to ensure the health of your future flock.\nSelective Breeding for Performance: Years of work have gone into refining this line for rich egg color, consistent type, and calm disposition. Expect feathered legs, varied tail feather genetics, and strong starts to growth and laying.  We have one Splash hen in this pen.\nA Range of Sizes & Colors: Due to genetic diversity and h",
    "variants": [
      {
        "id": 140,
        "sku": "FRN-WHT-MRN1",
        "label": "1 Dozen (12) Hatching Eggs",
        "price": 55.0,
        "compare": null,
        "stock": null
      }
    ]
  }
];

export const LOGO_URL = "/logo.png";

export const reviews: { name: string; date: string; text: string }[] = [
  {
    "name": "Destiny Durand",
    "date": "Mar 26, 2023",
    "text": "We had a wonderful experience with this farm. Pre-ordered some chicks and they arrived healthy."
  },
  {
    "name": "ZoovTxuj L Yaj",
    "date": "Mar 27, 2026",
    "text": "The eggs came in today. All of them were in perfect shape. The packaging was careful."
  },
  {
    "name": "Christine Nelson",
    "date": "May 31, 2025",
    "text": "We bought a dozen Deathlayer eggs that were shipped. 10 of them hatched."
  },
  {
    "name": "Diana Juarez",
    "date": "May 1, 2025",
    "text": "I bought half a dozen Black Copper Marans after a recommendation. The eggs looked great."
  },
  {
    "name": "Russell Goodlett",
    "date": "Apr 29, 2025",
    "text": "Purchased a dozen each of golden deathlayers and wheaten marans. About a 90 percent hatch."
  }
];
